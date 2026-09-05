// M7-01 — Real agent loop with iteration limits + checkpointing.
// M7-03 — Unified tool execution framework: generalized off MissionTask/
// Mission so the SAME loop mechanism can be reused by both mission tasks
// and the chat pipeline, instead of chat having no multi-step fallback at
// all. See the M7-03 section in docs/TEMO-ARCHITECTURE.md for the full
// mechanism map that motivated this.
// M7-04 — General confirmation/approval gate: when a tool call inside the
// loop is flagged requiresApproval (lib/tools/types.ts), the loop no
// longer treats the resulting pending-approval envelope as a plain tool
// failure. It pauses — checkpoints exactly which tool call is waiting and
// returns a distinct 'awaiting_approval' status instead of an answer —
// and, for mission tasks, genuinely resumes from that exact point once a
// human approves it (reusing the same checkpoint/resume mechanism M7-01
// built and live-verified for interruption recovery). Chat has no
// turn-state to resume into (see AgentLoopContext's comment below), so a
// chat-path pause is completed differently — see
// lib/context/context-manager.ts's M7-04 comment.
//
// Before M7-01, executeTask() (lib/swarm/executionLayer.ts) made exactly
// one chatWithFallback() call per task and returned — no multi-step
// reasoning, no tool-use loop. This file adds a bounded
// think -> act -> observe -> repeat loop.
//
// Deliberately reuses the EXISTING tool-execution primitive
// (toolExecutor.execute() — the same one lib/context/tool-decision.ts's
// decideTools()/toolPlanner already call) via a prompted ReAct-style
// text protocol (ACTION:/FINAL:), rather than building provider-native
// function-calling. chatWithFallback (lib/ai/ai-provider.ts) has never
// supported a `tools` parameter for any of the providers it fans out to
// — adding that across every provider is a materially larger, separate
// piece of work than either ticket scopes, and this codebase's stated
// principle is to extend existing working systems rather than build a
// second execution mechanism alongside them.
//
// Scope note (still true after M7-03/M7-04): lib/crew/manager-delegation.ts
// (executeWorker/managerReview — used both by delegated mission tasks and
// the live chat pipeline when a worker is assigned) is NOT touched here.
// A delegated worker still has zero tool-calling capability, so it has no
// approval gate to hit either. Confirmed a deliberate, explicitly-scoped-
// out gap (not an oversight) — closing it means touching the shared
// chat-pipeline file, a larger, separate follow-up flagged in the M7-01,
// M7-03, and M7-04 reports rather than silently expanded into any of them.

import { chatWithFallback, type ChatMessage, type ChatOptions } from '@/lib/ai/ai-provider';
import { toolRegistry } from '@/lib/tools/registry';
import { toolExecutor } from '@/lib/tools/executor';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { permissionEngine } from '@/lib/tools/permissions';
import type { AgentLoopState } from './types';
import type { ExecutionStep } from './executionTypes';

const DEFAULT_MAX_STEPS = 8;

// Matches "ACTION: tool.id({...json args...})" — case-insensitive, tool id
// may contain dots/dashes/underscores, args are a JSON object (possibly
// empty/malformed — malformed args are handled as a failed tool call, not
// a parse crash, since this is untrusted model output).
//
// M7-03 fix (was a known limitation tracked from M7-01's own E2E test):
// the LOOP_PROTOCOL_INSTRUCTIONS below tell the model to emit exactly one
// ACTION per turn, formatted on a single line — but the previous version
// of this regex used `[\s\S]*` for the args group, which spans newlines.
// A real live response once contained two consecutive "ACTION: tool(...)"
// lines in one turn; the greedy `[\s\S]*` spanned from the first tool's
// opening paren all the way to the SECOND tool's closing paren, producing
// a string that isn't valid JSON on its own, which silently fell back to
// empty arguments for the first (intended) call. Using `.` instead of
// `[\s\S]` keeps the args capture on a single line (JavaScript's `.`
// never matches `\n` without the `s`/dotAll flag, which is intentionally
// NOT set here) — for the same two-line input, this now correctly
// isolates just the first line's arguments instead of spanning into the
// second. Still relies on the model following the "single ACTION per
// turn" instruction for anything AFTER the first — a second ACTION line
// is simply never inspected, matching the protocol's "respond with
// EXACTLY ONE" instruction rather than accepting or silently mangling
// extras.
const ACTION_RE = /ACTION:\s*([a-z0-9_.-]+)\s*\((.*)\)\s*$/im;
// Matches "FINAL: <answer text>" — everything after the marker to the end
// of the response is the answer.
const FINAL_RE = /FINAL:\s*([\s\S]*)/im;

const LOOP_PROTOCOL_INSTRUCTIONS = `
You may need more than one step to complete this task. On each turn, respond with EXACTLY ONE of:

ACTION: tool.id({"argName": "value"})
  — to call one of the tools listed below. Put the entire call on one line. Wait for its OBSERVATION before deciding your next step.

FINAL: <your complete answer>
  — once you have everything needed to answer. This ends the task.

If you don't need any tools, just respond with FINAL: <your answer> immediately.`.trim();

function buildToolsCatalog(agentId: string): string {
  ensureBuiltinToolsRegistered();
  const permissions = permissionEngine.getPermissions(agentId);
  const tools = toolRegistry.listForAgent(agentId, permissions);
  if (tools.length === 0) return 'No tools are available to you for this task.';

  return tools
    .map((t) => {
      const params = [...t.requiredParams, ...t.optionalParams]
        .map((p) => `${p.name}${p.required ? '' : '?'}: ${p.type}`)
        .join(', ');
      return `- ${t.id}(${params}) — ${t.description}`;
    })
    .join('\n');
}

interface ToolStepResult {
  observation: string;
  /** M7-04: set when this call was gated and is now a real pending approval_requests row instead of having run. */
  pendingApprovalId?: string;
}

async function runToolStep(
  toolId: string,
  args: Record<string, unknown>,
  ctx: AgentLoopContext,
  approvedApprovalId?: string,
): Promise<ToolStepResult> {
  ensureBuiltinToolsRegistered();
  const registered = toolRegistry.get(toolId);
  if (!registered) {
    return {
      observation: `Error: tool "${toolId}" does not exist. Pick one from the list you were given, or respond with FINAL: if you have enough information already.`,
    };
  }

  const result = await toolExecutor.execute({
    id: `loop-${ctx.taskId ?? ctx.agentId}-${Date.now()}`,
    toolId,
    agentId: ctx.agentId,
    arguments: args,
    tenantId: ctx.tenantId,
    isSimulation: ctx.isSimulation,
    missionId: ctx.missionId,
    taskId: ctx.taskId,
    approvedApprovalId,
  });

  if (!result.ok) {
    // M7-04: a gated call with no approvedApprovalId yet — this is a
    // pause signal, not a plain failure. The caller (runAgentLoop) checks
    // pendingApprovalId and branches before ever turning this into an
    // "Error: ..." OBSERVATION.
    if (result.pendingApprovalId) {
      return { observation: '', pendingApprovalId: result.pendingApprovalId };
    }
    return { observation: `Error: ${result.error ?? 'tool execution failed'}` };
  }
  return { observation: typeof result.data === 'string' ? result.data : JSON.stringify(result.data) };
}

// M7-03: generalized off MissionTask/Mission — a mission task supplies
// its real ids plus checkpoint persistence (onCheckpoint/onClearCheckpoint
// wired to mission_tasks.loop_state by executionLayer.ts); the chat
// pipeline supplies just the identity/attribution fields and leaves the
// checkpoint callbacks unset (chat has nowhere to persist mid-conversation
// loop state today — an honest limitation, not a silent gap: a chat-path
// loop interrupted mid-flight simply cannot resume, same as chat's
// existing behavior for any other interrupted request. M7-04's approval
// pause is exactly this kind of interruption for chat — see
// context-manager.ts for how chat completes it differently instead).
export interface AgentLoopContext {
  agentId: string;
  tenantId?: string | null;
  isSimulation?: boolean;
  missionId?: string | null;
  taskId?: string | null;
  maxSteps?: number | null;
  initialLoopState?: AgentLoopState | null;
  onCheckpoint?: (state: AgentLoopState) => Promise<void>;
  onClearCheckpoint?: () => Promise<void>;
}

export interface AgentLoopResult {
  output: string;
  stepsUsed: number;
  steps: ExecutionStep[];
  /** M7-04: 'awaiting_approval' means this attempt paused on a gated tool call — output is empty, not a real answer. Default 'completed' for every pre-M7-04 return path. */
  status: 'completed' | 'awaiting_approval';
  /** M7-04: set only when status === 'awaiting_approval'. */
  pendingApprovalId?: string;
}

export async function runAgentLoop(
  systemPrompt: string,
  userPrompt: string,
  ctx: AgentLoopContext,
  chatOptions: Omit<ChatOptions, 'systemPrompt'>,
): Promise<AgentLoopResult> {
  const maxSteps = ctx.maxSteps || DEFAULT_MAX_STEPS;
  const steps: ExecutionStep[] = [];
  const fullSystemPrompt = `${systemPrompt}\n\n${LOOP_PROTOCOL_INSTRUCTIONS}\n\nAvailable tools:\n${buildToolsCatalog(ctx.agentId)}`;

  // Resume from a checkpoint left by an interrupted prior attempt (crash,
  // timeout, tab closed mid-loop) instead of restarting the reasoning
  // trace from message 1. A checkpoint is only ever present here if the
  // process never got the chance to clear it — see clearCheckpoint() call
  // sites below for every normal (success/failure) exit path. Only
  // possible when the caller supplies initialLoopState (mission tasks) —
  // chat callers never do, so this branch is simply unreachable for chat.
  let messages: ChatMessage[];
  let stepsUsed: number;
  if (ctx.initialLoopState && ctx.initialLoopState.messages.length > 0) {
    messages = [...ctx.initialLoopState.messages];
    stepsUsed = ctx.initialLoopState.stepsUsed;
    steps.push({
      step: 'Agent Loop Resume',
      status: 'completed',
      detail: `Resumed from checkpoint at step ${stepsUsed}`,
      durationMs: 0,
    });

    // M7-04: this specific resume is for a tool call that was left
    // pending approval — the only way this task's status ever flips back
    // to 'ready' (making it eligible to be picked up and re-enter this
    // function) is resolveApproval() doing so on an *approved* decision
    // (lib/governance/approvals.ts); a rejection fails the task directly
    // instead, so reaching this branch at all already means "approved."
    // Retry the exact same call with approvedApprovalId set (skips
    // re-gating in toolExecutor.execute()) instead of asking the model to
    // decide all over again — it already decided, a human just needed to
    // sign off.
    if (ctx.initialLoopState.pendingApproval) {
      const { approvalId, toolId, args } = ctx.initialLoopState.pendingApproval;
      const stepStart = Date.now();
      const toolResult = await runToolStep(toolId, args, ctx, approvalId);
      messages.push({ role: 'user', content: `OBSERVATION: ${toolResult.observation}` });
      steps.push({
        step: `Agent Loop Step ${stepsUsed} (resumed after approval)`,
        status: 'completed',
        detail: `Tool: ${toolId}`,
        durationMs: Date.now() - stepStart,
      });
      if (ctx.onCheckpoint) await ctx.onCheckpoint({ messages, stepsUsed, pendingApproval: null });
    }
  } else {
    messages = [{ role: 'user', content: userPrompt }];
    stepsUsed = 0;
  }

  while (stepsUsed < maxSteps) {
    const stepStart = Date.now();
    stepsUsed++;

    const result = await chatWithFallback(messages, { ...chatOptions, systemPrompt: fullSystemPrompt });
    messages.push({ role: 'assistant', content: result.content });

    const actionMatch = result.content.match(ACTION_RE);
    const finalMatch = result.content.match(FINAL_RE);

    if (actionMatch) {
      const toolId = actionMatch[1].trim();
      // actionMatch[2] is everything between the tool id's outer
      // parentheses, e.g. `{"query": "foo"}` — already a JSON object
      // literal as instructed in the loop protocol above. Malformed model
      // output (bad JSON, or no args at all) falls back to an empty
      // argument object rather than crashing the loop — the tool call
      // will then fail validation and the resulting OBSERVATION error
      // lets the model self-correct on its next step, same as any other
      // tool failure.
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(actionMatch[2].trim() || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        args = {};
      }

      const toolResult = await runToolStep(toolId, args, ctx);

      // M7-04: gated, not yet approved — pause instead of treating this
      // as a failed step. messages already has this turn's ACTION
      // assistant-message pushed above; deliberately does NOT push an
      // OBSERVATION yet (there isn't a real one), so resume picks up
      // exactly where a real tool result would have landed.
      if (toolResult.pendingApprovalId) {
        if (ctx.onCheckpoint) {
          await ctx.onCheckpoint({
            messages,
            stepsUsed,
            pendingApproval: { approvalId: toolResult.pendingApprovalId, toolId, args },
          });
        }
        steps.push({
          step: `Agent Loop Step ${stepsUsed}`,
          status: 'completed',
          detail: `Tool: ${toolId} — awaiting approval`,
          durationMs: Date.now() - stepStart,
        });
        return { output: '', stepsUsed, steps, status: 'awaiting_approval', pendingApprovalId: toolResult.pendingApprovalId };
      }

      messages.push({ role: 'user', content: `OBSERVATION: ${toolResult.observation}` });

      steps.push({
        step: `Agent Loop Step ${stepsUsed}`,
        status: 'completed',
        detail: `Tool: ${toolId}`,
        durationMs: Date.now() - stepStart,
      });

      // Checkpoint progress after every completed step so an interruption
      // partway through the NEXT step can resume from here. No-op for
      // callers (chat) that didn't supply onCheckpoint.
      if (ctx.onCheckpoint) await ctx.onCheckpoint({ messages, stepsUsed, pendingApproval: null });
      continue;
    }

    // FINAL: marker, or an unstructured response (treated as the answer
    // directly — matches how a plain one-shot response behaved before
    // this ticket; not every task needs multiple steps).
    const output = finalMatch ? finalMatch[1].trim() : result.content;
    if (ctx.onClearCheckpoint) await ctx.onClearCheckpoint();
    steps.push({
      step: `Agent Loop Step ${stepsUsed}`,
      status: 'completed',
      detail: finalMatch ? 'Final answer produced' : 'Unstructured final response',
      durationMs: Date.now() - stepStart,
    });
    return { output, stepsUsed, steps, status: 'completed' };
  }

  // Max steps exhausted without a final answer. This is a definitive
  // failure of THIS attempt, not an interruption — clear the checkpoint
  // rather than leaving it in place, otherwise a whole-task retry (the
  // maxRetries loop in executeTask()) would reload a checkpoint that's
  // already at the step cap and fail again instantly, burning every retry
  // attempt with zero further work done.
  if (ctx.onClearCheckpoint) await ctx.onClearCheckpoint();
  throw new Error(`Agent loop exceeded max steps (${maxSteps}) without producing a final answer.`);
}

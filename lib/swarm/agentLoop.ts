// M7-01 — Real agent loop with iteration limits + checkpointing.
//
// Before this file, executeTask() (lib/swarm/executionLayer.ts) made
// exactly one chatWithFallback() call per task and returned — no
// multi-step reasoning, no tool-use loop. Confirmed via repo-wide search
// before writing this: no "loop"/"iteration"/"checkpoint" concept existed
// anywhere in the execution path. This adds a bounded
// think -> act -> observe -> repeat loop for a single task's direct
// (non-delegated) LLM execution.
//
// Deliberately reuses the EXISTING tool-execution primitive
// (toolExecutor.execute() — the same one lib/context/tool-decision.ts's
// decideTools()/toolPlanner already call) via a prompted ReAct-style
// text protocol (ACTION:/FINAL:), rather than building provider-native
// function-calling. chatWithFallback (lib/ai/ai-provider.ts) has never
// supported a `tools` parameter for any of the providers it fans out to
// — adding that across every provider is a materially larger, separate
// piece of work than this ticket scopes, and this codebase's stated
// principle is to extend existing working systems rather than build a
// second execution mechanism alongside them.
//
// Scope note: this loop replaces the direct-manager LLM branch in
// executeTask() only (no worker assigned). lib/crew/manager-delegation.ts
// (executeWorker/managerReview — used both by delegated mission tasks and
// the live chat pipeline) is NOT touched here; looping those is a
// separate, larger follow-up given the chat-path blast radius, flagged in
// the M7-01 report rather than silently expanded into this ticket.

import { chatWithFallback, type ChatMessage, type ChatOptions } from '@/lib/ai/ai-provider';
import { toolRegistry } from '@/lib/tools/registry';
import { toolExecutor } from '@/lib/tools/executor';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { permissionEngine } from '@/lib/tools/permissions';
import { updateTask } from './missionService';
import type { MissionTask, Mission, AgentLoopState } from './types';
import type { ExecutionStep } from './executionTypes';

const DEFAULT_MAX_STEPS = 8;

// Matches "ACTION: tool.id({...json args...})" — case-insensitive, tool id
// may contain dots/dashes/underscores, args are a JSON object (possibly
// empty/malformed — malformed args are handled as a failed tool call, not
// a parse crash, since this is untrusted model output).
const ACTION_RE = /ACTION:\s*([a-z0-9_.-]+)\s*\(([\s\S]*)\)\s*$/im;
// Matches "FINAL: <answer text>" — everything after the marker to the end
// of the response is the answer.
const FINAL_RE = /FINAL:\s*([\s\S]*)/im;

const LOOP_PROTOCOL_INSTRUCTIONS = `
You may need more than one step to complete this task. On each turn, respond with EXACTLY ONE of:

ACTION: tool.id({"argName": "value"})
  — to call one of the tools listed below. Wait for its OBSERVATION before deciding your next step.

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

async function runToolStep(
  toolId: string,
  args: Record<string, unknown>,
  agentId: string,
  mission: Mission,
  task: MissionTask,
): Promise<string> {
  ensureBuiltinToolsRegistered();
  const registered = toolRegistry.get(toolId);
  if (!registered) {
    return `Error: tool "${toolId}" does not exist. Pick one from the list you were given, or respond with FINAL: if you have enough information already.`;
  }

  const result = await toolExecutor.execute({
    id: `loop-${task.id}-${Date.now()}`,
    toolId,
    agentId,
    arguments: args,
    tenantId: mission.tenantId,
    isSimulation: mission.isSimulation,
    missionId: mission.id,
    taskId: task.id,
  });

  if (!result.ok) {
    return `Error: ${result.error ?? 'tool execution failed'}`;
  }
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
}

async function checkpoint(taskId: string, state: AgentLoopState): Promise<void> {
  await updateTask(taskId, { loopState: state });
}

async function clearCheckpoint(taskId: string): Promise<void> {
  await updateTask(taskId, { loopState: null });
}

export interface AgentLoopResult {
  output: string;
  stepsUsed: number;
  steps: ExecutionStep[];
}

export async function runAgentLoop(
  task: MissionTask,
  mission: Mission,
  agentId: string,
  systemPrompt: string,
  userPrompt: string,
  chatOptions: Omit<ChatOptions, 'systemPrompt'>,
): Promise<AgentLoopResult> {
  const maxSteps = task.maxLoopSteps || DEFAULT_MAX_STEPS;
  const steps: ExecutionStep[] = [];
  const fullSystemPrompt = `${systemPrompt}\n\n${LOOP_PROTOCOL_INSTRUCTIONS}\n\nAvailable tools:\n${buildToolsCatalog(agentId)}`;

  // Resume from a checkpoint left by an interrupted prior attempt (crash,
  // timeout, tab closed mid-loop) instead of restarting the reasoning
  // trace from message 1. A checkpoint is only ever present here if the
  // process never got the chance to clear it — see clearCheckpoint() call
  // sites below for every normal (success/failure) exit path.
  let messages: ChatMessage[];
  let stepsUsed: number;
  if (task.loopState && task.loopState.messages.length > 0) {
    messages = [...task.loopState.messages];
    stepsUsed = task.loopState.stepsUsed;
    steps.push({
      step: 'Agent Loop Resume',
      status: 'completed',
      detail: `Resumed from checkpoint at step ${stepsUsed}`,
      durationMs: 0,
    });
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

      const observation = await runToolStep(toolId, args, agentId, mission, task);
      messages.push({ role: 'user', content: `OBSERVATION: ${observation}` });

      steps.push({
        step: `Agent Loop Step ${stepsUsed}`,
        status: 'completed',
        detail: `Tool: ${toolId}`,
        durationMs: Date.now() - stepStart,
      });

      // Checkpoint progress after every completed step so an interruption
      // partway through the NEXT step can resume from here.
      await checkpoint(task.id, { messages, stepsUsed });
      continue;
    }

    // FINAL: marker, or an unstructured response (treated as the answer
    // directly — matches how a plain one-shot response behaved before
    // this ticket; not every task needs multiple steps).
    const output = finalMatch ? finalMatch[1].trim() : result.content;
    await clearCheckpoint(task.id);
    steps.push({
      step: `Agent Loop Step ${stepsUsed}`,
      status: 'completed',
      detail: finalMatch ? 'Final answer produced' : 'Unstructured final response',
      durationMs: Date.now() - stepStart,
    });
    return { output, stepsUsed, steps };
  }

  // Max steps exhausted without a final answer. This is a definitive
  // failure of THIS attempt, not an interruption — clear the checkpoint
  // rather than leaving it in place, otherwise a whole-task retry (the
  // maxRetries loop in executeTask()) would reload a checkpoint that's
  // already at the step cap and fail again instantly, burning every retry
  // attempt with zero further work done.
  await clearCheckpoint(task.id);
  throw new Error(`Agent loop exceeded max steps (${maxSteps}) without producing a final answer.`);
}

// Tool Decision Engine — Priority 2 in the reasoning pipeline.
// If a Tool can answer the user's request, execute it. Never guess.
// Never fabricate success. If the tool fails, return the error.

import { toolRegistry } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { toolPlanner, ToolPlanningError } from '@/lib/tools/planner';
import { permissionEngine } from '@/lib/tools/permissions';
import { toolExecutor } from '@/lib/tools/executor';
import { logger } from '@/lib/utils/logger';
import type { ToolResultEnvelope, ToolRequest } from '@/lib/tools/types';
import type { ChainResult } from '@/lib/tools/chain';
import type { DetectedIntent, ToolExecutionRecord } from './types';

// M7-03: explicit tri-state outcome, added to close a real seam a live
// E2E test exposed — callers used to each re-derive "did this actually
// resolve the request" from the shouldUseTool/success/toolAnswer
// combination themselves, inconsistently. lib/swarm/executionLayer.ts's
// executeTask() already fell through to the agent loop (M7-01) correctly
// on any non-'handled' outcome; lib/context/context-manager.ts (chat)
// had no fallback at all and just proceeded straight to a plain LLM call
// regardless of *why* the tool gate didn't resolve things. This field
// makes that reason explicit and shared, so both callers can coordinate
// on it instead of quietly diverging.
export type ToolDecisionOutcome =
  | 'handled' // a tool fully answered the request — no further reasoning needed
  | 'declined_no_match' // no tool category matched this input at all — the fast-path shortcut
  | 'attempted_failed' // a tool category matched, but planning/execution didn't produce a full answer
  // M7-04 bugfix (found live during M7-04's own E2E test, same day):
  // distinct from BOTH of the above on purpose. The planner can plan
  // MULTIPLE tool calls in one batch (e.g. memory.recall + memory.forget
  // for "show me X, then delete it") — before this fix, if even one
  // planned call succeeded, `anySuccess` was true and the whole batch was
  // marked 'handled', with buildToolAnswer() silently filtering the
  // gated/pending call out of the answer entirely. Live-confirmed: a task
  // reported status:'completed' with "memory.forget succeeded" in its own
  // result text while the target memory was still there, deleted_at:
  // null — the approval_requests row sat orphaned, pending forever,
  // because the task already looked finished and nothing would ever
  // think to check it. This value can never be produced alongside
  // 'handled' or silently coerced into 'attempted_failed' — callers must
  // handle it explicitly (pause, don't complete and don't fail).
  //
  // KNOWN SCOPE BOUNDARY (M7-04b, deliberate, not an oversight): this
  // outcome guarantees a gated call from THIS path never auto-executes
  // without a real approval — but a mission-task-originated approval
  // created here does not yet genuinely auto-resume once approved (see
  // the full explanation at its handling site in
  // lib/swarm/executionLayer.ts). Chat-originated approvals are
  // unaffected — those complete via direct execution in
  // app/api/approvals/[id]/confirm/route.ts, not this task-resume path.
  | 'pending_approval';

/**
 * M7-13c-2a: WHY a tool decision did not produce an answer — so callers can tell a failure that
 * will come out the same on every retry (fail now, with the specific reason) from one that may
 * pass on a retry (provider outage, an empty search, a flaky tool).
 */
export type ToolFailureKind =
  | 'no_tools_for_agent' // the agent has no registered tool it is permitted to use at all
  | 'no_match' // planning worked and nothing fit
  | 'planner_unavailable' // every AI provider failed / timed out while choosing a tool (transient)
  | 'planner_no_tenant' // no tenant to run the planner for (configuration, not transient)
  | 'planner_unusable' // the planner answered with something unusable (may differ on retry)
  | 'invalid_params' // a required parameter is missing/blank or has the wrong type
  | 'permission_denied'
  | 'tool_not_found'
  | 'not_implemented' // placeholder tool: no real integration exists yet
  | 'not_configured' // the tool needs configuration that is missing/rejected (e.g. no API key for this workspace)
  | 'empty_result' // the tool ran but returned nothing usable (may differ on retry)
  | 'tool_error'; // anything else the tool reported

/** Failures that are deterministic: retrying the same task cannot change the outcome. */
export const NON_RETRYABLE_TOOL_FAILURES: ReadonlySet<ToolFailureKind> = new Set<ToolFailureKind>([
  'no_tools_for_agent', 'no_match', 'planner_no_tenant', 'invalid_params', 'permission_denied', 'tool_not_found', 'not_implemented', 'not_configured',
]);

/** Text a tool "answer" must never consist of: it means the tool returned nothing real. */
const PLACEHOLDER_ANSWERS = new Set(['result', 'results', 'undefined', 'null', 'n/a', '[object object]']);
export function isPlaceholderAnswer(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!…]+$/, '');
  return t === '' || PLACEHOLDER_ANSWERS.has(t);
}

export interface ToolDecisionResult {
  shouldUseTool: boolean;
  selectedToolIds: string[];
  executions: ToolExecutionRecord[];
  toolAnswer: string | null;
  success: boolean;
  error: string | null;
  outcome: ToolDecisionOutcome;
  /** M7-04 bugfix: set only when outcome === 'pending_approval'. */
  pendingApprovalId?: string;
  /** M7-13c-2a: set whenever the decision did not produce an answer (see ToolFailureKind). */
  failureKind?: ToolFailureKind;
}

/** M7-13c-1: start of the error text used when the tool planner could not run at all (as opposed to running and finding no match). */
export const PLANNER_UNAVAILABLE_PREFIX = 'The tool planner was unavailable';

export async function decideTools(
  input: string,
  intent: DetectedIntent,
  agentId: string,
  tenantId?: string | null,
  isSimulation?: boolean,
  missionId?: string | null,
  taskId?: string | null,
): Promise<ToolDecisionResult> {
  // toolRegistry is an in-memory singleton per JS process; the browser tab
  // and the Next.js server process each hold their own instance. Registration
  // used to only happen client-side (components/providers.tsx's mount
  // effect), so a server-executed caller (the background task-queue
  // processor) would see an empty registry here and silently never resolve
  // a tool candidate. Idempotent — safe to call on every decision.
  ensureBuiltinToolsRegistered();

  if (!intent.asksForToolAction || intent.toolCategoryHint === 'none') {
    return {
      shouldUseTool: false,
      selectedToolIds: [],
      executions: [],
      toolAnswer: null,
      success: false,
      error: null,
      outcome: 'declined_no_match',
    };
  }

  // Map the intent's tool category hint to tool IDs in the registry
  const candidateToolIds = resolveToolIds(intent.toolCategoryHint);

  if (candidateToolIds.length === 0) {
    return {
      shouldUseTool: false,
      selectedToolIds: [],
      executions: [],
      toolAnswer: null,
      success: false,
      error: null,
      outcome: 'declined_no_match',
    };
  }

  // Use the AI tool planner to pick the best tool(s) and arguments.
  // M6-01: this used to be `.catch(() => null)` — any real planner failure
  // (every fallback AI provider exhausted, or an unparseable response) was
  // indistinguishable from the AI legitimately deciding no tool fits, and
  // fell straight into the direct-pattern fallback below with zero trace of
  // what actually happened (found live during M5-11 testing, surfaced only
  // as an empty "Tool execution failed for: "). toolPlanner.plan() now
  // throws ToolPlanningError (already logged with full diagnostic context
  // at the source) instead of swallowing internally, so this can make an
  // explicit, documented decision rather than a silent one.
  const permissions = permissionEngine.getPermissions(agentId);
  let plan: Awaited<ReturnType<typeof toolPlanner.plan>> = null;
  let plannerFailureReason: string | null = null;
  let plannerFailureKind: ToolFailureKind | null = null;
  // M7-13c-2a: how many tools this agent may use at all — distinguishes "nothing is available to it"
  // from "something was available and nothing fit" when the planner returns no plan.
  const availableToolCount = toolRegistry.listForAgent(agentId, permissions).length;
  try {
    plan = await toolPlanner.plan(input, agentId, permissions, tenantId);
  } catch (err) {
    if (err instanceof ToolPlanningError) {
      plannerFailureKind = err.code === 'planner_unavailable' ? 'planner_unavailable' : err.code === 'no_tenant' ? 'planner_no_tenant' : 'planner_unusable';
      // M7-13c-1: when the planner's AI call itself failed (every candidate down / timed out), say
      // so — and that the task can be retried — rather than letting the empty result below read as
      // "no tool matched". PLANNER_UNAVAILABLE_PREFIX is also what callers/tests key on.
      plannerFailureReason = err.code === 'planner_unavailable'
        ? `${PLANNER_UNAVAILABLE_PREFIX} (every AI provider failed or timed out while choosing a tool, so nothing was run) — this task can be retried. Detail: ${err.message}`
        : err.message;
      logger.error('decideTools: tool planner failed, falling back to direct-pattern execution', {
        error: err.message,
        provider: err.provider,
        agentId,
        timestamp: Date.now(),
      });
    } else {
      // Genuinely unexpected — not something planner.ts's own contract
      // promised to catch. Re-throw rather than absorb an unknown failure
      // mode into the same "no tool found" bucket.
      throw err;
    }
  }

  const executions: ToolExecutionRecord[] = [];

  if (plan && plan.tools.length > 0) {
    // Execute the planned tools
    for (const t of plan.tools) {
      const toolDef = toolRegistry.get(t.toolId);
      if (!toolDef) continue;

      const start = Date.now();
      const request: ToolRequest = {
        id: `ctx-${Date.now()}-${t.toolId}`,
        toolId: t.toolId,
        agentId,
        arguments: t.arguments,
        tenantId,
        isSimulation,
        missionId,
        taskId,
      };

      try {
        const result = await toolExecutor.execute(request);
        const durationMs = Date.now() - start;
        const success = 'ok' in result ? result.ok : ('success' in (result as Record<string, unknown>) ? (result as Record<string, unknown>).success === true : false);
        const error = 'ok' in result && !result.ok ? result.error : undefined;

        executions.push({
          toolId: t.toolId,
          toolName: toolDef.definition.name,
          arguments: t.arguments,
          result,
          success,
          durationMs,
          error: error ?? undefined,
        });
      } catch (err) {
        const durationMs = Date.now() - start;
        executions.push({
          toolId: t.toolId,
          toolName: toolDef.definition.name,
          arguments: t.arguments,
          result: {
            ok: false,
            toolId: t.toolId,
            requestId: request.id,
            agentId,
            error: err instanceof Error ? err.message : 'Unknown error',
            durationMs,
            retries: 0,
            streaming: false,
            timestamp: Date.now(),
          } as ToolResultEnvelope,
          success: false,
          durationMs,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  } else {
    // Planner didn't produce a plan — try direct execution for known patterns
    const directResult = await executeDirectTool(input, intent, agentId, candidateToolIds);
    if (directResult) {
      executions.push(directResult);
    }
  }

  const selectedToolIds = executions.map((e) => e.toolId);

  // M7-04 bugfix: check for a gated/pending call FIRST, before anySuccess
  // is even computed from the batch — a pending approval must never be
  // eligible to be masked by a co-planned success, and must never be
  // eligible to fall into the plain allFailed/'attempted_failed' path
  // either. 'result' is ToolResultEnvelope | ChainResult; only the former
  // ever carries pendingApprovalId.
  const pendingExecution = executions.find(
    (e) => 'pendingApprovalId' in e.result && (e.result as ToolResultEnvelope).pendingApprovalId,
  );
  if (pendingExecution) {
    const pendingApprovalId = (pendingExecution.result as ToolResultEnvelope).pendingApprovalId;
    return {
      shouldUseTool: true,
      selectedToolIds,
      executions,
      toolAnswer: null,
      success: false,
      error: null,
      outcome: 'pending_approval',
      pendingApprovalId,
    };
  }

  const anySuccess = executions.some((e) => e.success);
  const allFailed = executions.length > 0 && !anySuccess;

  // Build the tool answer from results
  let toolAnswer: string | null = null;
  if (anySuccess && executions.length > 0) {
    toolAnswer = buildToolAnswer(executions);
  }

  // M6-01: executions.length === 0 (nothing ran at all — no plan, and no
  // direct-pattern match either) used to fall through to `error: null`
  // here, the other half of the same silent-swallow bug: `shouldUseTool:
  // true, success: false, error: null` gives the caller no way to tell
  // "planner genuinely failed" from "nothing matched and that's fine."
  // Always carry a real, documented reason when nothing executed.
  //
  // M7-13c-2a: and always carry a machine-readable failureKind next to it, so a failure that is
  // deterministic (no tool for this agent, no match, bad parameters, a placeholder tool) is not
  // retried four times, and the stored reason names the real cause.
  let error: string | null = null;
  let failureKind: ToolFailureKind | undefined;
  if (allFailed) {
    const classified = classifyExecutionFailures(executions);
    error = classified.error;
    failureKind = classified.kind;
  } else if (executions.length === 0) {
    if (plannerFailureReason) {
      error = plannerFailureReason;
      failureKind = plannerFailureKind ?? 'planner_unusable';
    } else if (availableToolCount === 0) {
      error = `No tools available: agent "${agentId}" has no registered tool it is permitted to use for this request.`;
      failureKind = 'no_tools_for_agent';
    } else {
      error = 'No matching tool could be planned or matched for this request.';
      failureKind = 'no_match';
    }
  } else if (!toolAnswer || toolAnswer.trim().length === 0) {
    // M7-13c-2a: a tool "succeeded" but produced no usable content (live: web.search without a
    // summary became the literal answer "Result" and the task was saved as completed). That is
    // not a success: report it as a failure with a reason.
    toolAnswer = null;
    error = `Tool ${selectedToolIds.join(', ')} ran but returned no usable content, so the request was not answered.`;
    failureKind = 'empty_result';
  }

  return {
    shouldUseTool: true,
    selectedToolIds,
    executions,
    toolAnswer,
    success: anySuccess && failureKind !== 'empty_result',
    error,
    outcome: toolAnswer && anySuccess ? 'handled' : 'attempted_failed',
    ...(failureKind ? { failureKind } : {}),
  };
}

/** M7-13c-2a: map the executor's typed failure codes to a ToolFailureKind. */
function failureKindOfExecution(e: ToolExecutionRecord): ToolFailureKind {
  const r = e.result;
  const code = 'ok' in r && !r.ok ? r.errorCode : undefined;
  switch (code) {
    case 'missing_params':
    case 'invalid_params':
      return 'invalid_params';
    case 'permission_denied':
      return 'permission_denied';
    case 'tool_not_found':
      return 'tool_not_found';
    case 'not_implemented':
      return 'not_implemented';
    case 'not_configured':
      return 'not_configured';
    default:
      return 'tool_error';
  }
}

/**
 * The overall kind is a NON-retryable one only when EVERY failed execution is deterministic;
 * a mix with a transient failure stays a plain 'tool_error' (the retry might fix the transient part).
 */
function classifyExecutionFailures(executions: ToolExecutionRecord[]): { kind: ToolFailureKind; error: string } {
  const failed = executions.filter((e) => !e.success);
  const kinds = failed.map(failureKindOfExecution);
  const allDeterministic = kinds.length > 0 && kinds.every((k) => NON_RETRYABLE_TOOL_FAILURES.has(k));
  const messages = failed.map((e, i) =>
    kinds[i] === 'not_implemented'
      ? `Tool "${e.toolId}" is not implemented yet — no real action was taken.`
      : (e.error ?? `Tool "${e.toolId}" failed.`),
  );
  return { kind: allDeterministic ? kinds[0] : 'tool_error', error: messages.join('; ') };
}

function resolveToolIds(category: DetectedIntent['toolCategoryHint']): string[] {
  if (category === 'none') return [];

  const all = toolRegistry.list();
  const matches: string[] = [];

  for (const t of all) {
    if (category === 'n8n' && t.category === 'n8n') matches.push(t.id);
    if (category === 'github' && (t.id.includes('github') || t.id.includes('repo'))) matches.push(t.id);
    if (category === 'files' && t.category === 'files') matches.push(t.id);
    if (category === 'web' && t.category === 'web') matches.push(t.id);
    if (category === 'memory' && t.category === 'memory') matches.push(t.id);
  }

  return matches;
}

async function executeDirectTool(
  input: string,
  intent: DetectedIntent,
  agentId: string,
  candidateToolIds: string[],
): Promise<ToolExecutionRecord | null> {
  // For memory timeline requests, directly execute memory.timeline tool
  if (intent.asksAboutTimeline && candidateToolIds.includes('memory.timeline')) {
    const toolDef = toolRegistry.get('memory.timeline');
    if (!toolDef) return null;

    const start = Date.now();
    const request: ToolRequest = {
      id: `ctx-${Date.now()}-timeline`,
      toolId: 'memory.timeline',
      agentId,
      arguments: { limit: 10 },
    };

    try {
      const result = await toolExecutor.execute(request);
      return {
        toolId: 'memory.timeline',
        toolName: toolDef.definition.name,
        arguments: { limit: 10 },
        result,
        success: 'ok' in result ? result.ok : true,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        toolId: 'memory.timeline',
        toolName: toolDef.definition.name,
        arguments: { limit: 10 },
        result: {
          ok: false,
          toolId: 'memory.timeline',
          requestId: request.id,
          agentId,
          error: err instanceof Error ? err.message : 'Unknown',
          durationMs: Date.now() - start,
          retries: 0,
          streaming: false,
          timestamp: Date.now(),
        } as ToolResultEnvelope,
        success: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown',
      };
    }
  }

  return null;
}

function buildToolAnswer(executions: ToolExecutionRecord[]): string {
  const successful = executions.filter((e) => e.success);
  if (successful.length === 0) return '';

  const parts: string[] = [];
  for (const e of successful) {
    const data = extractData(e.result);

    // M7-13c-2a: only REAL content becomes part of an answer. A blank string, or a placeholder such
    // as the literal "Result" (what this used to fall back to for an object with no name/title/id),
    // is dropped — if nothing real is left the caller reports an empty-result failure.
    let text = '';
    if (typeof data === 'string') {
      text = data;
    } else if (data && typeof data === 'object') {
      text = textFromObject(data as Record<string, unknown>, e.toolId);
    }
    if (!isPlaceholderAnswer(text)) parts.push(text.trim());
  }

  return parts.join('\n\n');
}

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function textFromObject(obj: Record<string, unknown>, toolId: string): string {
  // A simulated/sandboxed call carries an honest explanation instead of a result.
  if (obj.simulated === true && nonBlank(obj.note)) return obj.note;
  if (nonBlank(obj.summary)) return obj.summary;
  if (nonBlank(obj.message)) return obj.message;
  if (Array.isArray(obj.results)) return formatSearchResults(obj.results);
  if (Array.isArray(obj.workflows) || Array.isArray(obj.data)) {
    return formatListAsHumanReadable((obj.workflows ?? obj.data) as unknown[], toolId);
  }
  return formatObjectAsHumanReadable(obj, toolId);
}

/** web.search results without a generated summary: list what was actually found. Empty list -> '' (no usable content). */
function formatSearchResults(results: unknown[]): string {
  const lines: string[] = [];
  for (const r of results.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const title = nonBlank(o.title) ? o.title.trim() : '';
    const url = nonBlank(o.url) ? o.url.trim() : '';
    const snippet = nonBlank(o.snippet) ? o.snippet.trim() : '';
    if (!title && !url && !snippet) continue;
    lines.push(`• ${title || url}${title && url ? ` — ${url}` : ''}${snippet ? `\n  ${snippet}` : ''}`);
  }
  return lines.length > 0 ? `Search results:\n\n${lines.join('\n')}` : '';
}

function formatListAsHumanReadable(items: unknown[], toolId: string): string {
  if (items.length === 0) return 'No items found.';

  const lines: string[] = [];
  if (toolId.startsWith('n8n') || toolId.includes('workflow')) {
    lines.push(`You currently have ${items.length} workflow${items.length === 1 ? '' : 's'}:`);
    lines.push('');
    for (const item of items) {
      const obj = item as Record<string, unknown>;
      const name = obj.name ?? obj.id ?? 'Unnamed';
      const status = obj.active ? 'Active' : 'Inactive';
      lines.push(`• ${name} (${status})`);
    }
    return lines.join('\n');
  }

  for (const item of items) {
    const label = typeof item === 'string'
      ? item
      : (item && typeof item === 'object'
        ? ((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).title ?? (item as Record<string, unknown>).id)
        : undefined);
    if (nonBlank(label) || typeof label === 'number') lines.push(`• ${label}`);
  }
  // Items with no name/title/id carry nothing we can show: not a usable answer.
  if (lines.length === 0) return '';
  return [`Found ${items.length} item${items.length === 1 ? '' : 's'}:`, '', ...lines].join('\n');
}

function formatObjectAsHumanReadable(obj: Record<string, unknown>, toolId: string): string {
  if (toolId.startsWith('n8n') || toolId.includes('workflow')) {
    const wfName = obj.name ?? obj.id;
    if (!nonBlank(wfName) && typeof wfName !== 'number') return '';
    const status = obj.active ? 'Active' : 'Inactive';
    return `Workflow: ${wfName} (${status})`;
  }

  // No name/title/id means there is nothing to show — never a stand-in word like "Result".
  const name = obj.name ?? obj.title ?? obj.id;
  if (nonBlank(name)) return name;
  if (typeof name === 'number') return String(name);
  return '';
}

function extractData(result: ToolResultEnvelope | ChainResult): unknown {
  if ('ok' in result) {
    return result.data;
  }
  if ('success' in result && 'results' in result) {
    const chain = result as ChainResult;
    const last = chain.results[chain.results.length - 1];
    return last?.data;
  }
  return null;
}

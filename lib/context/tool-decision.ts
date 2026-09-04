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
  | 'attempted_failed'; // a tool category matched, but planning/execution didn't produce a full answer

export interface ToolDecisionResult {
  shouldUseTool: boolean;
  selectedToolIds: string[];
  executions: ToolExecutionRecord[];
  toolAnswer: string | null;
  success: boolean;
  error: string | null;
  outcome: ToolDecisionOutcome;
}

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
  try {
    plan = await toolPlanner.plan(input, agentId, permissions);
  } catch (err) {
    if (err instanceof ToolPlanningError) {
      plannerFailureReason = err.message;
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
  let error: string | null = null;
  if (allFailed) {
    error = executions.map((e) => e.error).filter(Boolean).join('; ');
  } else if (executions.length === 0) {
    error = plannerFailureReason ?? 'No matching tool could be planned or matched for this request.';
  }

  return {
    shouldUseTool: true,
    selectedToolIds,
    executions,
    toolAnswer,
    success: anySuccess,
    error,
    outcome: toolAnswer && anySuccess ? 'handled' : 'attempted_failed',
  };
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

    // If the tool returned a human-readable summary, use it directly
    if (typeof data === 'string') {
      parts.push(data);
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.summary === 'string') {
        parts.push(obj.summary);
      } else if (typeof obj.message === 'string') {
        parts.push(obj.message);
      } else if (Array.isArray(obj.workflows) || Array.isArray(obj.data)) {
        const arr = (obj.workflows ?? obj.data) as unknown[];
        parts.push(formatListAsHumanReadable(arr, e.toolId));
      } else {
        parts.push(formatObjectAsHumanReadable(obj, e.toolId));
      }
    }
  }

  return parts.join('\n\n');
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

  lines.push(`Found ${items.length} item${items.length === 1 ? '' : 's'}:`);
  lines.push('');
  for (const item of items) {
    const obj = item as Record<string, unknown>;
    const name = obj.name ?? obj.title ?? obj.id ?? 'Unknown';
    lines.push(`• ${name}`);
  }
  return lines.join('\n');
}

function formatObjectAsHumanReadable(obj: Record<string, unknown>, toolId: string): string {
  if (toolId.startsWith('n8n') || toolId.includes('workflow')) {
    const name = obj.name ?? obj.id ?? 'Workflow';
    const status = obj.active ? 'Active' : 'Inactive';
    return `Workflow: ${name} (${status})`;
  }

  const name = obj.name ?? obj.title ?? obj.id ?? 'Result';
  return `${name}`;
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

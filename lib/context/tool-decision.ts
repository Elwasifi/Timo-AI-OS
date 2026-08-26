// Tool Decision Engine — Priority 2 in the reasoning pipeline.
// If a Tool can answer the user's request, execute it. Never guess.
// Never fabricate success. If the tool fails, return the error.

import { toolRegistry } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { toolPlanner } from '@/lib/tools/planner';
import { permissionEngine } from '@/lib/tools/permissions';
import { toolExecutor } from '@/lib/tools/executor';
import type { ToolResultEnvelope, ToolRequest } from '@/lib/tools/types';
import type { ChainResult } from '@/lib/tools/chain';
import type { DetectedIntent, ToolExecutionRecord } from './types';

export interface ToolDecisionResult {
  shouldUseTool: boolean;
  selectedToolIds: string[];
  executions: ToolExecutionRecord[];
  toolAnswer: string | null;
  success: boolean;
  error: string | null;
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
    };
  }

  // Use the AI tool planner to pick the best tool(s) and arguments
  const permissions = permissionEngine.getPermissions(agentId);
  const plan = await toolPlanner.plan(input, agentId, permissions).catch(() => null);

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

  return {
    shouldUseTool: true,
    selectedToolIds,
    executions,
    toolAnswer,
    success: anySuccess,
    error: allFailed ? executions.map((e) => e.error).filter(Boolean).join('; ') : null,
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

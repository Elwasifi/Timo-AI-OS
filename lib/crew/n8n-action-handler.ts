// Flow n8n Action Handler — the bridge between the Flow agent and the n8n
// integration layer. Flow NEVER calls the n8n API directly; it goes through
// the existing services/n8n gateway. This module parses natural-language
// n8n requests into structured actions, executes them, and returns a
// human-readable summary for the agent to relay.

import { n8n, N8nProxyError, type N8nWorkflow, type N8nExecution } from '@/services/n8n';
import { logger } from '@/lib/utils/logger';

export type N8nActionType =
  | 'list'
  | 'create'
  | 'run'
  | 'activate'
  | 'deactivate'
  | 'delete'
  | 'import'
  | 'export'
  | 'search'
  | 'convert'
  | 'sync'
  | 'unknown';

export interface N8nActionResult {
  action: N8nActionType;
  success: boolean;
  summary: string;
  data?: unknown;
}

interface ParsedAction {
  type: N8nActionType;
  workflowName?: string;
  workflowId?: string;
  workflowData?: Partial<N8nWorkflow>;
  tag?: string;
}

const ACTION_PATTERNS: { type: N8nActionType; pattern: RegExp }[] = [
  { type: 'list', pattern: /\b(list|show|get all|view)\b.*\bworkflow/i },
  { type: 'search', pattern: /\b(search|find|filter)\b.*\bworkflow/i },
  { type: 'create', pattern: /\b(create|make|new|build)\b.*\bworkflow/i },
  { type: 'run', pattern: /\b(run|execute|start|trigger)\b.*\bworkflow/i },
  { type: 'convert', pattern: /\b(convert|enable webhook|add webhook)\b.*\bworkflow/i },
  { type: 'sync', pattern: /\b(sync|synchronize|refresh)\b.*\b(registry|workflows)\b/i },
  { type: 'activate', pattern: /\b(activate|enable|turn on)\b.*\bworkflow/i },
  { type: 'deactivate', pattern: /\b(deactivate|disable|turn off|pause)\b.*\bworkflow/i },
  { type: 'delete', pattern: /\b(delete|remove|destroy)\b.*\bworkflow/i },
  { type: 'import', pattern: /\b(import|load)\b.*\bworkflow/i },
  { type: 'export', pattern: /\b(export|download|save)\b.*\bworkflow/i },
];

export function parseN8nAction(input: string): ParsedAction {
  const lower = input.toLowerCase();

  for (const { type, pattern } of ACTION_PATTERNS) {
    if (pattern.test(lower)) {
      // A quoted name is unambiguous — check it first. Without this, the
      // fuzzy fallback regex below can be satisfied by the leading verb
      // itself (e.g. "run workflow \"Daily Report\"" — the lazy capture
      // group is satisfied by "run" the instant it hits the literal word
      // "workflow" that follows it, never reaching the real quoted name).
      const quotedMatch = input.match(/["']([^"'\n]+)["']/);
      const nameMatch = quotedMatch ? null : input.match(/(?:workflow\s+(?:named|called|with name|id)\s+)?["']?([^"'\n]+?)["']?(?:\s+(?:workflow|now|please|$))/i);
      const workflowName = quotedMatch?.[1]?.trim() ?? nameMatch?.[1]?.trim();
      const tagMatch = input.match(/\b(?:tag(?:ged)?|label(?:ed)?)\s+["']?([^"'\n]+?)["']?/i);
      return {
        type,
        workflowName,
        tag: tagMatch?.[1]?.trim(),
      };
    }
  }

  return { type: 'unknown' };
}

export async function executeN8nAction(input: string): Promise<N8nActionResult> {
  const parsed = parseN8nAction(input);
  logger.routing(`Flow n8n action: ${parsed.type}`, { input: input.slice(0, 80) });

  try {
    switch (parsed.type) {
      case 'list':
        return await handleList();
      case 'search':
        return await handleSearch(parsed.tag ?? parsed.workflowName ?? '');
      case 'create':
        return await handleCreate(parsed.workflowName ?? 'New Workflow');
      case 'run':
        return await handleRun(parsed.workflowName ?? parsed.workflowId ?? '');
      case 'convert':
        return await handleConvert(parsed.workflowName ?? parsed.workflowId ?? '');
      case 'sync':
        return await handleSync();
      case 'activate':
        return await handleActivate(parsed.workflowName ?? parsed.workflowId ?? '');
      case 'deactivate':
        return await handleDeactivate(parsed.workflowName ?? parsed.workflowId ?? '');
      case 'delete':
        return await handleDelete(parsed.workflowName ?? parsed.workflowId ?? '');
      case 'import':
        return await handleImport(parsed.workflowName ?? 'Imported Workflow');
      case 'export':
        return await handleExport(parsed.workflowName ?? parsed.workflowId ?? '');
      default:
        return {
          action: 'unknown',
          success: false,
          summary: "I couldn't determine which n8n action you wanted. Try: list workflows, run workflow \"name\", activate workflow \"name\", delete workflow \"name\", etc.",
        };
    }
  } catch (err) {
    const message = err instanceof N8nProxyError ? err.message : err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Flow n8n action failed: ${parsed.type}`, { error: message });
    return {
      action: parsed.type,
      success: false,
      summary: `n8n action failed: ${message}`,
    };
  }
}

async function handleList(): Promise<N8nActionResult> {
  const workflows = await n8n.workflows.list();
  if (workflows.length === 0) {
    return { action: 'list', success: true, summary: 'No workflows found in your n8n instance.', data: workflows };
  }
  const lines = workflows.map((w) => `- **${w.name}** (ID: ${w.id}) — ${w.active ? 'Active' : 'Inactive'}${w.updatedAt ? `, updated ${new Date(w.updatedAt).toLocaleDateString()}` : ''}`);
  return {
    action: 'list',
    success: true,
    summary: `Found ${workflows.length} workflow${workflows.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
    data: workflows,
  };
}

async function handleSearch(query: string): Promise<N8nActionResult> {
  if (!query) {
    return { action: 'search', success: false, summary: 'Please specify a tag or name to search for.' };
  }
  const workflows = await n8n.workflows.search(query);
  if (workflows.length === 0) {
    return { action: 'search', success: true, summary: `No workflows found matching "${query}".`, data: [] };
  }
  const lines = workflows.map((w) => `- **${w.name}** (ID: ${w.id}) — ${w.active ? 'Active' : 'Inactive'}`);
  return { action: 'search', success: true, summary: `Found ${workflows.length} workflow(s) matching "${query}":\n${lines.join('\n')}`, data: workflows };
}

async function handleCreate(name: string): Promise<N8nActionResult> {
  const workflow = await n8n.workflows.create({ name, nodes: [], connections: {} });
  return { action: 'create', success: true, summary: `Created workflow "${workflow.name}" (ID: ${workflow.id}).`, data: workflow };
}

// M1-04: the trigger's HTTP status only confirms the webhook was received,
// not that the workflow actually finished (n8n's `onReceived` response mode
// responds to the caller before execution completes). Poll the execution
// history for the real terminal status instead of reporting the trigger's
// HTTP 200 as "Done."
const EXECUTION_POLL_INTERVAL_MS = 1500;
const EXECUTION_POLL_TIMEOUT_MS = 20000;

async function waitForExecutionResult(workflowId: string, triggeredAt: number): Promise<N8nExecution | null> {
  const deadline = Date.now() + EXECUTION_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { data: executions } = await n8n.executions.listExecutions(5, undefined, workflowId);
      const candidate = executions.find((e) => {
        if (!e.startedAt) return false;
        // A few seconds of slack for clock skew between this process and n8n.
        return new Date(e.startedAt).getTime() >= triggeredAt - 5000;
      });
      if (candidate && (candidate.finished || candidate.status === 'error')) {
        return candidate;
      }
    } catch {
      // Transient poll failure — keep trying until the deadline; a real
      // failure to ever confirm is handled by the timeout path below, not
      // a single failed poll.
    }
    await new Promise((r) => setTimeout(r, EXECUTION_POLL_INTERVAL_MS));
  }
  return null;
}

async function handleRun(idOrName: string): Promise<N8nActionResult> {
  if (!idOrName) {
    return { action: 'run', success: false, summary: 'Please specify a workflow ID or name to run.' };
  }
  const triggeredAt = Date.now();
  let result;
  if (/^\d+$/.test(idOrName)) {
    result = await n8n.executions.trigger(idOrName);
  } else {
    result = await n8n.executions.triggerByName(idOrName);
  }
  if (result.message) {
    return { action: 'run', success: false, summary: result.message, data: result };
  }
  if (!result.httpStatus || result.httpStatus >= 400) {
    return { action: 'run', success: false, summary: `Trigger request to "${result.workflowName}" failed (HTTP ${result.httpStatus ?? 'N/A'}).`, data: result };
  }

  const execution = await waitForExecutionResult(result.workflowId, triggeredAt);
  if (!execution) {
    return {
      action: 'run',
      success: false,
      summary: `I triggered "${result.workflowName}" but couldn't confirm it finished within ${EXECUTION_POLL_TIMEOUT_MS / 1000}s — check n8n directly.`,
      data: result,
    };
  }
  if (execution.status === 'error') {
    return {
      action: 'run',
      success: false,
      summary: `Workflow "${result.workflowName}" ran but failed: ${execution.data?.resultData?.error?.message ?? 'unknown error'}.`,
      data: { ...result, execution },
    };
  }
  return {
    action: 'run',
    success: true,
    summary: `Workflow "${result.workflowName}" completed successfully (execution ${execution.id}).`,
    data: { ...result, execution },
  };
}

async function handleActivate(idOrName: string): Promise<N8nActionResult> {
  const wf = await resolveWorkflow(idOrName);
  if (!wf) return notFound(idOrName);
  const updated = await n8n.workflows.activate(wf.id);
  return { action: 'activate', success: true, summary: `Activated workflow "${updated.name}".`, data: updated };
}

async function handleDeactivate(idOrName: string): Promise<N8nActionResult> {
  const wf = await resolveWorkflow(idOrName);
  if (!wf) return notFound(idOrName);
  const updated = await n8n.workflows.deactivate(wf.id);
  return { action: 'deactivate', success: true, summary: `Deactivated workflow "${updated.name}".`, data: updated };
}

async function handleDelete(idOrName: string): Promise<N8nActionResult> {
  const wf = await resolveWorkflow(idOrName);
  if (!wf) return notFound(idOrName);
  await n8n.workflows.delete(wf.id);
  return { action: 'delete', success: true, summary: `Deleted workflow "${wf.name}" (ID: ${wf.id}).` };
}

async function handleImport(name: string): Promise<N8nActionResult> {
  const workflow = await n8n.workflows.import({ name, nodes: [], connections: {} });
  return { action: 'import', success: true, summary: `Imported workflow "${workflow.name}" (ID: ${workflow.id}).`, data: workflow };
}

async function handleExport(idOrName: string): Promise<N8nActionResult> {
  const wf = await resolveWorkflow(idOrName);
  if (!wf) return notFound(idOrName);
  const exported = await n8n.workflows.export(wf.id);
  return { action: 'export', success: true, summary: `Exported workflow "${exported.name}" (ID: ${exported.id}). The workflow definition is ready to copy.`, data: exported };
}

async function handleConvert(idOrName: string): Promise<N8nActionResult> {
  const wf = await resolveWorkflow(idOrName);
  if (!wf) return notFound(idOrName);
  const result = await n8n.workflows.convertToWebhook(wf.id);
  return {
    action: 'convert',
    success: true,
    summary: `Converted "${wf.name}" to a webhook-enabled workflow. New workflow: "${result.newWorkflowName}" (ID: ${result.newWorkflowId}). Webhook URL: ${result.webhookUrl}`,
    data: result,
  };
}

async function handleSync(): Promise<N8nActionResult> {
  const entries = await n8n.workflows.syncRegistry();
  const byType = entries.reduce((acc, e) => {
    acc[e.triggerType] = (acc[e.triggerType] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const summary = `Synced ${entries.length} workflows to the registry. Trigger breakdown: ${Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ')}.`;
  return { action: 'sync', success: true, summary, data: entries };
}

async function resolveWorkflow(idOrName: string): Promise<N8nWorkflow | null> {
  if (!idOrName) return null;
  if (/^\d+$/.test(idOrName)) {
    return await n8n.workflows.get(idOrName);
  }
  const workflows = await n8n.workflows.list();
  return workflows.find((w) => w.name.toLowerCase() === idOrName.toLowerCase()) ?? null;
}

function notFound(idOrName: string): N8nActionResult {
  return { action: 'unknown', success: false, summary: `Workflow "${idOrName}" not found. Use "list workflows" to see available workflows.` };
}

export function isN8nRequest(input: string): boolean {
  const lower = input.toLowerCase();
  return ACTION_PATTERNS.some(({ pattern }) => pattern.test(lower));
}

// M7-13c-2a: decideTools() must never report a tool as having answered when it returned nothing
// usable (live: web.search without a generated summary was saved as the literal answer "Result"
// and the mission task completed), must say WHY nothing was answered, and must tag the failure so
// deterministic ones are not retried. Planner, executor and registry are stubbed; decideTools and
// its answer formatting are real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const registryState = vi.hoisted(() => ({ available: [{ id: 'web.search' }] as Array<{ id: string }> }));

vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => registryState.available),
    list: vi.fn(() => [{ id: 'web.search', category: 'web' }, { id: 'files.write', category: 'files' }, { id: 'n8n.listWorkflows', category: 'n8n' }]),
    get: vi.fn((id: string) => ({ definition: { id, name: id } })),
  },
}));
vi.mock('@/lib/tools/builtin-tools', () => ({ ensureBuiltinToolsRegistered: vi.fn() }));
vi.mock('@/lib/tools/permissions', () => ({ permissionEngine: { getPermissions: vi.fn(() => ['web', 'files', 'n8n']) } }));
vi.mock('@/lib/tools/planner', async (orig) => {
  const actual = await orig<typeof import('@/lib/tools/planner')>();
  return { ...actual, toolPlanner: { plan: vi.fn() } };
});
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));

import { decideTools, isPlaceholderAnswer, NON_RETRYABLE_TOOL_FAILURES, PLANNER_UNAVAILABLE_PREFIX } from '@/lib/context/tool-decision';
import { toolPlanner, ToolPlanningError } from '@/lib/tools/planner';
import { toolExecutor } from '@/lib/tools/executor';
import type { DetectedIntent } from '@/lib/context/types';

const intent = (category: string) => ({ asksForToolAction: true, toolCategoryHint: category, asksAboutTimeline: false }) as unknown as DetectedIntent;
const planOf = (toolId: string, args: Record<string, unknown> = { query: 'q' }) => ({ tools: [{ toolId, arguments: args }], explanation: 'x' });
const ok = (toolId: string, data: unknown) => ({ ok: true, toolId, requestId: 'r', agentId: 'echo', data, durationMs: 1, retries: 0, streaming: false, timestamp: 1 });
const fail = (toolId: string, error: string, errorCode?: string) => ({ ok: false, toolId, requestId: 'r', agentId: 'echo', error, ...(errorCode ? { errorCode } : {}), durationMs: 1, retries: 0, streaming: false, timestamp: 1 });

const decide = (category = 'web') => decideTools('search for open source jarvis', intent(category), 'echo', 'client-tenant');

beforeEach(() => {
  registryState.available = [{ id: 'web.search' }];
  vi.mocked(toolPlanner.plan).mockReset();
  vi.mocked(toolExecutor.execute).mockReset();
});

describe('a tool that returns nothing usable is a FAILURE, never the answer "Result"', () => {
  it('web.search with no summary and no results -> empty_result failure with a reason (this was the live false success)', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { results: [], query: 'q', count: 0, summary: undefined }) as never);
    const r = await decide();
    expect(r.success).toBe(false);
    expect(r.outcome).toBe('attempted_failed');
    expect(r.failureKind).toBe('empty_result');
    expect(r.toolAnswer).toBeNull();
    expect(r.error).toMatch(/web\.search ran but returned no usable content/);
    expect(r.error).not.toMatch(/^Result$/);
    expect(NON_RETRYABLE_TOOL_FAILURES.has('empty_result')).toBe(false); // an empty search can differ on a retry
  });

  it('web.search with RESULTS but no summary -> the real results become the answer (not "Result")', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', {
      results: [{ title: 'Open-JARVIS', url: 'https://github.com/x/jarvis', snippet: 'An open source assistant' }, { title: 'Second', url: 'https://example.com' }],
      query: 'q', count: 2,
    }) as never);
    const r = await decide();
    expect(r.success).toBe(true);
    expect(r.outcome).toBe('handled');
    expect(r.toolAnswer).toContain('Open-JARVIS');
    expect(r.toolAnswer).toContain('https://github.com/x/jarvis');
    expect(r.toolAnswer).toContain('An open source assistant');
    expect(isPlaceholderAnswer(r.toolAnswer as string)).toBe(false);
    expect(r.failureKind).toBeUndefined();
  });

  it('a real summary is used as before', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { results: [{ title: 't' }], query: 'q', count: 1, summary: 'Jarvis projects: A, B, C.' }) as never);
    const r = await decide();
    expect(r.toolAnswer).toBe('Jarvis projects: A, B, C.');
    expect(r.outcome).toBe('handled');
  });

  it('an object with no name/title/id (the old "Result" fallback) is an empty_result failure', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { foo: 1, bar: [1, 2] }) as never);
    const r = await decide();
    expect(r.failureKind).toBe('empty_result');
    expect(r.toolAnswer).toBeNull();
  });

  it('blank / placeholder string data is also a failure; a real string is an answer', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    for (const junk of ['', '   ', 'Result', 'null', '[object Object]']) {
      vi.mocked(toolExecutor.execute).mockResolvedValueOnce(ok('web.search', junk) as never);
      expect((await decide()).failureKind, `data=${JSON.stringify(junk)}`).toBe('empty_result');
    }
    vi.mocked(toolExecutor.execute).mockResolvedValueOnce(ok('web.search', 'Three projects found.') as never);
    expect((await decide()).toolAnswer).toBe('Three projects found.');
  });

  it('a simulated/sandboxed call returns its honest note instead of a placeholder', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { simulated: true, note: 'Simulated execution of "web.search" — no real external action was taken.', wouldHaveCalledWith: { query: 'q' } }) as never);
    const r = await decide();
    expect(r.toolAnswer).toMatch(/Simulated execution of "web\.search"/);
  });

  it('an n8n workflow list keeps working: a list with names is an answer, an empty list is the honest "No items found."', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('n8n.listWorkflows', {}));
    vi.mocked(toolExecutor.execute).mockResolvedValueOnce(ok('n8n.listWorkflows', { workflows: [{ name: 'Daily report', active: true }] }) as never);
    expect((await decide('n8n')).toolAnswer).toMatch(/Daily report \(Active\)/);
    vi.mocked(toolExecutor.execute).mockResolvedValueOnce(ok('n8n.listWorkflows', { workflows: [] }) as never);
    expect((await decide('n8n')).toolAnswer).toBe('No items found.');
  });
});

describe('failures carry a specific reason and a kind (deterministic ones are tagged non-retryable)', () => {
  it('missing required parameter -> invalid_params, the executor\'s own message, non-retryable', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search', {}));
    vi.mocked(toolExecutor.execute).mockResolvedValue(fail('web.search', 'Validation failed for "web.search": param "query" — required parameter missing', 'missing_params') as never);
    const r = await decide();
    expect(r.success).toBe(false);
    expect(r.failureKind).toBe('invalid_params');
    expect(r.error).toContain('param "query"');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(r.failureKind!)).toBe(true);
  });

  it('placeholder tool -> not_implemented with a clear message, non-retryable', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('files.write', { path: 'a', content: 'b' }));
    vi.mocked(toolExecutor.execute).mockResolvedValue(fail('files.write', 'files.write is not yet implemented — no real action was taken. ...', 'not_implemented') as never);
    const r = await decide('files');
    expect(r.failureKind).toBe('not_implemented');
    expect(r.error).toBe('Tool "files.write" is not implemented yet — no real action was taken.');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(r.failureKind!)).toBe(true);
  });

  it('missing configuration (no API key for this workspace) -> not_configured, the specific message is preserved, non-retryable (M7-13c-2a-4)', async () => {
    const msg = 'web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.';
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValue(fail('web.search', msg, 'not_configured') as never);
    const r = await decide();
    expect(r.success).toBe(false);
    expect(r.failureKind).toBe('not_configured');
    expect(r.error).toBe(msg);
    expect(NON_RETRYABLE_TOOL_FAILURES.has(r.failureKind!)).toBe(true);
  });

  it('permission denied -> non-retryable; an uncoded (transient) tool error stays retryable', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue(planOf('web.search'));
    vi.mocked(toolExecutor.execute).mockResolvedValueOnce(fail('web.search', 'Agent "x" lacks permission(s): web', 'permission_denied') as never);
    expect((await decide()).failureKind).toBe('permission_denied');
    vi.mocked(toolExecutor.execute).mockResolvedValueOnce(fail('web.search', 'socket hang up') as never);
    const transient = await decide();
    expect(transient.failureKind).toBe('tool_error');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(transient.failureKind!)).toBe(false);
  });

  it('a deterministic failure mixed with a transient one is NOT tagged non-retryable (the retry might fix the transient part)', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue({ tools: [{ toolId: 'files.write', arguments: {} }, { toolId: 'web.search', arguments: {} }], explanation: 'x' });
    vi.mocked(toolExecutor.execute)
      .mockResolvedValueOnce(fail('files.write', 'not impl', 'not_implemented') as never)   // deterministic FIRST, so a wrong "any" rule would pick it
      .mockResolvedValueOnce(fail('web.search', 'socket hang up') as never);
    const r = await decide();
    expect(r.failureKind).toBe('tool_error');
  });

  it('agent with NO tools available -> no_tools_for_agent (names the agent), non-retryable', async () => {
    registryState.available = [];
    vi.mocked(toolPlanner.plan).mockResolvedValue(null);
    const r = await decide();
    expect(r.failureKind).toBe('no_tools_for_agent');
    expect(r.error).toBe('No tools available: agent "echo" has no registered tool it is permitted to use for this request.');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(r.failureKind!)).toBe(true);
  });

  it('planner succeeded but nothing fit -> no_match with the established wording, non-retryable', async () => {
    vi.mocked(toolPlanner.plan).mockResolvedValue({ tools: [], explanation: 'no matching tool' });
    const r = await decide();
    expect(r.failureKind).toBe('no_match');
    expect(r.error).toBe('No matching tool could be planned or matched for this request.');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(r.failureKind!)).toBe(true);
  });

  it('planner unavailable (providers down) -> planner_unavailable, RETRYABLE; no tenant -> non-retryable', async () => {
    vi.mocked(toolPlanner.plan).mockRejectedValueOnce(new ToolPlanningError('Tool planning failed: timeout', null, 'groq', 'planner_unavailable'));
    const down = await decide();
    expect(down.failureKind).toBe('planner_unavailable');
    expect(down.error).toContain(PLANNER_UNAVAILABLE_PREFIX);
    expect(NON_RETRYABLE_TOOL_FAILURES.has(down.failureKind!)).toBe(false);

    vi.mocked(toolPlanner.plan).mockRejectedValueOnce(new ToolPlanningError('Tool planning needs a resolved tenant', null, undefined, 'no_tenant'));
    const noTenant = await decide();
    expect(noTenant.failureKind).toBe('planner_no_tenant');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(noTenant.failureKind!)).toBe(true);
  });

  it('an unparseable planner answer stays retryable', async () => {
    vi.mocked(toolPlanner.plan).mockRejectedValueOnce(new ToolPlanningError('Planner returned unparseable output', null, 'groq'));
    const r = await decide();
    expect(r.failureKind).toBe('planner_unusable');
    expect(NON_RETRYABLE_TOOL_FAILURES.has(r.failureKind!)).toBe(false);
  });
});

describe('isPlaceholderAnswer', () => {
  it('flags blank text and the stand-in words a tool leaves behind', () => {
    for (const t of ['', '  ', 'Result', ' result. ', 'RESULTS', 'null', 'undefined', 'N/A', '[object Object]']) expect(isPlaceholderAnswer(t), JSON.stringify(t)).toBe(true);
  });
  it('does not flag real (even very short) answers', () => {
    for (const t of ['Yes', '4', 'No items found.', 'Result: 42 projects found', 'Done deploying to staging']) expect(isPlaceholderAnswer(t), JSON.stringify(t)).toBe(false);
  });
});

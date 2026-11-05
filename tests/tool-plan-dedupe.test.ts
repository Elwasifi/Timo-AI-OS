// M7-13c-2b-1b: inside ONE decideTools plan,
//   (B1b) identical planned calls (same tool + deeply-equal arguments) run once;
//   (B1)  after a call fails with a NON-RETRYABLE kind, the later calls to the SAME tool are skipped (not reported as
//         failures), other tools still run, and retryable failures do not skip anything;
//   (B2)  the failure text carries each distinct sentence once.
// Planner, registry and executor are stubbed; decideTools is real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => [{ id: 'web.search' }, { id: 'files.read' }]),
    list: vi.fn(() => [{ id: 'web.search', category: 'web' }, { id: 'files.read', category: 'web' }]),
    get: vi.fn((id: string) => ({ definition: { id, name: id } })),
  },
}));
vi.mock('@/lib/tools/builtin-tools', () => ({ ensureBuiltinToolsRegistered: vi.fn() }));
vi.mock('@/lib/tools/permissions', () => ({ permissionEngine: { getPermissions: vi.fn(() => ['web']) } }));
vi.mock('@/lib/tools/planner', async (orig) => {
  const actual = await orig<typeof import('@/lib/tools/planner')>();
  return { ...actual, toolPlanner: { plan: vi.fn() } };
});
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));

import { decideTools } from '@/lib/context/tool-decision';
import { toolPlanner } from '@/lib/tools/planner';
import { toolExecutor } from '@/lib/tools/executor';
import type { DetectedIntent } from '@/lib/context/types';

const intent = { asksForToolAction: true, toolCategoryHint: 'web', asksAboutTimeline: false } as unknown as DetectedIntent;
const call = (toolId: string, args: Record<string, unknown>) => ({ toolId, arguments: args });
const plan = (...tools: Array<ReturnType<typeof call>>) => vi.mocked(toolPlanner.plan).mockResolvedValue({ tools, explanation: 'x' } as never);
const ok = (toolId: string, data: unknown) => ({ ok: true, toolId, requestId: 'r', agentId: 'nova', data, durationMs: 1, retries: 0, streaming: false, timestamp: 1 });
const fail = (toolId: string, error: string, errorCode?: string) => ({ ok: false, toolId, requestId: 'r', agentId: 'nova', error, ...(errorCode ? { errorCode } : {}), durationMs: 1, retries: 1, streaming: false, timestamp: 1 });
const run = () => decideTools('review code quality', intent, 'nova', 'client-tenant');
const executed = () => vi.mocked(toolExecutor.execute).mock.calls.map((c) => [(c[0] as { toolId: string }).toolId, (c[0] as { arguments: unknown }).arguments]);
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const QUOTA = "Gemini's request limit for models gemini-flash-lite-latest and gemini-3.6-flash was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio.";

beforeEach(() => {
  vi.mocked(toolPlanner.plan).mockReset();
  vi.mocked(toolExecutor.execute).mockReset();
});

describe('B1b: identical planned calls run once', () => {
  it('5 web.search calls with identical arguments -> the executor is called once and the answer is used', async () => {
    plan(...Array.from({ length: 5 }, () => call('web.search', { query: 'jarvis', max_results: 5 })));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { results: [{ title: 'T' }], query: 'jarvis', count: 1, summary: 'Found it.' }) as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(r.executions).toHaveLength(1);
    expect(r.success).toBe(true);
    expect(r.toolAnswer).toBe('Found it.');
  });
  it('identical arguments given in a different key order are still the same call', async () => {
    plan(call('web.search', { query: 'jarvis', max_results: 5 }), call('web.search', { max_results: 5, query: 'jarvis' }));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { summary: 'Found.' }) as never);
    await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
  });
  it('calls with DIFFERENT arguments (or a different tool) are NOT merged', async () => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }), call('files.read', { query: 'a' }));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { summary: 'Found.' }) as never);
    await run();
    expect(executed()).toEqual([['web.search', { query: 'a' }], ['web.search', { query: 'b' }], ['files.read', { query: 'a' }]]);
  });
  it('nested argument differences count as different calls', async () => {
    plan(call('web.search', { query: 'a', opts: { days: 7 } }), call('web.search', { query: 'a', opts: { days: 30 } }));
    vi.mocked(toolExecutor.execute).mockResolvedValue(ok('web.search', { summary: 'Found.' }) as never);
    await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
  });
});

describe('B1: a non-retryable failure skips the same tool\'s later calls', () => {
  it('5 web.search calls with DIFFERENT arguments, the first fails quota_exceeded -> exactly one call; the sentence appears once', async () => {
    plan(...['a', 'b', 'c', 'd', 'e'].map((q) => call('web.search', { query: q })));
    vi.mocked(toolExecutor.execute).mockResolvedValue(fail('web.search', QUOTA, 'quota_exceeded') as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(r.executions).toHaveLength(1);            // the skipped calls are not reported as failures
    expect(r.success).toBe(false);
    expect(r.failureKind).toBe('quota_exceeded');
    expect(r.error).toBe(QUOTA);
    expect(count(r.error as string, 'Gemini')).toBe(1);
  });
  it.each(['not_configured', 'permission_denied', 'tool_not_found', 'not_implemented'])('%s also skips the same tool\'s later calls', async (code) => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }), call('web.search', { query: 'c' }));
    vi.mocked(toolExecutor.execute).mockResolvedValue(fail('web.search', `reason for ${code}`, code) as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(r.failureKind).toBe(code);
  });
  it('invalid_params is specific to the arguments of ONE call: later calls to the same tool with other arguments still run (and can succeed)', async () => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }));
    vi.mocked(toolExecutor.execute)
      .mockResolvedValueOnce(fail('web.search', 'param "query" is invalid', 'invalid_params') as never)
      .mockResolvedValueOnce(ok('web.search', { summary: 'Found b.' }) as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
    expect(r.success).toBe(true);
    expect(r.toolAnswer).toBe('Found b.');
  });
  it('two IDENTICAL calls are still run once even when the first fails invalid_params', async () => {
    plan(call('web.search', { query: '' }), call('web.search', { query: '' }));
    vi.mocked(toolExecutor.execute).mockResolvedValue(fail('web.search', 'param "query" is required', 'invalid_params') as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(r.executions).toHaveLength(1);
    expect(r.failureKind).toBe('invalid_params');
  });
  it('[web.search quota fails, another tool] -> the other tool still runs and its answer is used', async () => {
    plan(call('web.search', { query: 'a' }), call('files.read', { query: 'x' }), call('web.search', { query: 'b' }));
    vi.mocked(toolExecutor.execute).mockImplementation((async (req: { toolId: string }) =>
      req.toolId === 'web.search' ? fail('web.search', QUOTA, 'quota_exceeded') : ok('files.read', { summary: 'File content.' })) as never);
    const r = await run();
    expect(executed()).toEqual([['web.search', { query: 'a' }], ['files.read', { query: 'x' }]]); // 2nd web.search skipped
    expect(r.success).toBe(true);
    expect(r.toolAnswer).toBe('File content.');
  });
  it('a failing OTHER tool does not block this tool: only the failing tool\'s own later calls are skipped', async () => {
    plan(call('files.read', { query: '1' }), call('web.search', { query: 'a' }), call('files.read', { query: '2' }));
    vi.mocked(toolExecutor.execute).mockImplementation((async (req: { toolId: string }) =>
      req.toolId === 'files.read' ? fail('files.read', 'no access', 'permission_denied') : ok('web.search', { summary: 'Web.' })) as never);
    await run();
    expect(executed()).toEqual([['files.read', { query: '1' }], ['web.search', { query: 'a' }]]);
  });
});

describe('retryable failures keep today\'s behaviour', () => {
  it('a tool_error (no errorCode) on the first call does NOT skip the later calls of the same tool', async () => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }), call('web.search', { query: 'c' }));
    vi.mocked(toolExecutor.execute)
      .mockResolvedValueOnce(fail('web.search', 'Gemini grounding request failed (503): overloaded') as never)
      .mockResolvedValue(ok('web.search', { summary: 'Found.' }) as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(3);
    expect(r.success).toBe(true);
  });
  it('an empty_result on the first call does NOT skip later calls of the same tool', async () => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }));
    vi.mocked(toolExecutor.execute)
      .mockResolvedValueOnce(ok('web.search', { results: [], query: 'a', count: 0 }) as never)
      .mockResolvedValue(ok('web.search', { summary: 'Found.' }) as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
    expect(r.toolAnswer).toContain('Found.');
  });
  it('an executor that THROWS is a retryable failure: later calls still run', async () => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }));
    vi.mocked(toolExecutor.execute)
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(ok('web.search', { summary: 'Found.' }) as never);
    const r = await run();
    expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
    expect(r.success).toBe(true);
  });
  it('all retryable failures: each distinct failure is reported, identical sentences once with a count', async () => {
    plan(call('web.search', { query: 'a' }), call('web.search', { query: 'b' }), call('web.search', { query: 'c' }));
    vi.mocked(toolExecutor.execute)
      .mockResolvedValueOnce(fail('web.search', 'Gemini grounding request failed (503): overloaded') as never)
      .mockResolvedValueOnce(fail('web.search', 'Gemini grounding request failed (503): overloaded') as never)
      .mockResolvedValueOnce(fail('web.search', 'Timed out') as never);
    const r = await run();
    expect(r.failureKind).toBe('tool_error');
    expect(r.error).toBe('Gemini grounding request failed (503): overloaded (repeated 2 times); Timed out');
  });
});

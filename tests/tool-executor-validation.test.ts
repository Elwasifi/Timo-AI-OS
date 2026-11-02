// M7-13c-2a: required parameters and placeholder tools in the REAL executor.
//  - an empty / whitespace-only string is not a value for a required parameter;
//  - a placeholder tool (google/github/files/voice) fails once with a typed, specific
//    "not implemented" failure — never a fake success, never retried.
// Governance lookups are stubbed (no DB); the tools, registry and executor are real.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', () => ({
  getTenantExecutionMode: vi.fn(async () => 'live'),
  categoryHasRealSandboxIsolation: vi.fn(() => false),
  SANDBOX_TENANT_ID: '00000000-0000-0000-0000-0000000000ff',
}));

import { toolExecutor } from '@/lib/tools/executor';
import { toolRegistry } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import type { ToolDefinition } from '@/lib/tools/types';

beforeAll(() => { ensureBuiltinToolsRegistered(); });

const handler = vi.fn(async (args: Record<string, unknown>) => ({ echoed: args }));

const searchTool: ToolDefinition = {
  id: 'test.search', name: 'Test search', description: 'x', category: 'web', permissions: ['web'],
  requiredParams: [{ name: 'query', type: 'string', description: 'q', required: true }],
  optionalParams: [{ name: 'note', type: 'string', description: 'n', required: false }],
  responseSchema: { type: 'object', fields: {} }, status: 'active', version: '1.0.0', supportedAgents: [],
};

const run = (toolId: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  toolExecutor.execute({ id: 'req-' + Math.random(), toolId, agentId: 'nova', arguments: args, tenantId: 't', executionMode: 'live', ...extra } as never);

describe('required parameters: blank is missing', () => {
  beforeAll(() => { toolRegistry.register(searchTool, handler); });
  afterEach(() => { handler.mockClear(); });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['tab/newline only', ' \t\n '],
    ['undefined', undefined],
    ['null', null],
  ])('%s -> missing_params, handler never called', async (_label, value) => {
    const r = await run('test.search', { query: value });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('missing_params');
    expect(r.error).toMatch(/param "query"/);
    expect(r.error).toMatch(/required parameter missing/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a real value still passes and reaches the handler unchanged', async () => {
    const r = await run('test.search', { query: ' open source jarvis ' });
    expect(r.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ query: ' open source jarvis ' });
  });

  it('an OPTIONAL blank string is still allowed (only required parameters changed)', async () => {
    const r = await run('test.search', { query: 'ok', note: '' });
    expect(r.ok).toBe(true);
  });

  it('a wrong type is reported as invalid_params, not missing', async () => {
    const r = await run('test.search', { query: 42 });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('invalid_params');
    expect(handler).not.toHaveBeenCalled();
  });

  it('real built-ins: web.search with a blank query and n8n.getWorkflow-style blank ids are rejected before any handler runs', async () => {
    expect((await run('web.search', { query: '  ' })).errorCode).toBe('missing_params');
    expect((await run('n8n.activateWorkflow', { id: '' }, { agentId: 'flow' })).errorCode).toBe('missing_params');
    expect((await run('memory.recall', { id: '   ' })).errorCode).toBe('permission_denied'); // nova has no memory scope: permission is checked first
  });

  it('typed failure codes for the other deterministic cases', async () => {
    expect((await run('does.not.exist', {})).errorCode).toBe('tool_not_found');
    expect((await run('memory.search', { query: 'x' }, { agentId: 'sentinel-none' })).errorCode).toBe('permission_denied');
  });
});

describe('placeholder tools fail honestly, once', () => {
  it('files.write: ok=false, errorCode not_implemented, a specific message, and NOT retried even when the request asks for 3 retries', async () => {
    const r = await run('files.write', { path: 'a.txt', content: 'hello' }, { retries: 3 });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('not_implemented');
    expect(r.error).toMatch(/files\.write is not yet implemented/);
    expect(r.error).toMatch(/no real action was taken/);
    expect(r.retries).toBe(1); // exactly one attempt
  });

  it.each(['google.gmail.send', 'github.commitFile', 'files.read'])('%s is also a typed not_implemented failure', async (toolId) => {
    const args: Record<string, Record<string, unknown>> = {
      'google.gmail.send': { to: 'a@b.c', subject: 's', body: 'b' },
      'github.commitFile': { repo: 'o/r', path: 'p', content: 'c', message: 'm' },
      'files.read': { path: 'a.txt' },
    };
    const r = await run(toolId, args[toolId], { agentId: toolId.startsWith('google') ? 'echo' : 'nova' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('not_implemented');
  });

  it('a transient handler error is still retried (the retry loop is unchanged for errors that can pass)', async () => {
    let calls = 0;
    toolRegistry.register({ ...searchTool, id: 'test.flaky' }, async () => { calls++; if (calls < 2) throw new Error('socket hang up'); return { ok: 1 }; });
    const r = await run('test.flaky', { query: 'x' }, { retries: 2 });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    toolRegistry.unregister('test.flaky');
  }, 15000);
});

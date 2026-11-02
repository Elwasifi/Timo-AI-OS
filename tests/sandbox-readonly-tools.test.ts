// M7-13c-2a-2: Sandbox ("Demo") mode runs READ-ONLY tools for real and keeps simulating
// everything with a side effect — like a demo trading account that shows real prices but
// places no real orders. Live 2026-11-02: web.search in sandbox returned
// "Simulated execution of "web.search"" and the mission still ended COMPLETED.
// Real executor + real registry + real built-in definitions; the web.search handler, the tenant-mode
// lookup and approvals are stubbed (no network, no DB). categoryHasRealSandboxIsolation is the REAL one.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ mode: 'sandbox' as 'live' | 'sandbox' | 'simulation', webSearch: vi.fn() }));

vi.mock('@/lib/tools/webSearch', () => ({ webSearchHandler: h.webSearch }));
vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/executionMode')>();
  return { ...actual, getTenantExecutionMode: vi.fn(async () => h.mode) };
});

import { toolExecutor } from '@/lib/tools/executor';
import { toolRegistry } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { SANDBOX_TENANT_ID } from '@/lib/governance/executionMode';
import type { ToolDefinition, ToolExecutionContext } from '@/lib/tools/types';

const WEB_RESULT = { results: [{ title: 'Open-JARVIS', url: 'https://github.com/x/jarvis', snippet: '' }], query: 'jarvis', count: 1, summary: 'Found it.' };

const sideEffectHandler = vi.fn(async (args: Record<string, unknown>) => ({ wrote: args }));
const readOnlyUndefinedHandler = vi.fn(async () => ({ ok: 1 }));
const flaggedReadOnlyHandler = vi.fn(async () => ({ read: 1 }));
const memoryHandler = vi.fn(async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => ({ tenantSeen: ctx.tenantId }));

const baseDef = (id: string, extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id, name: id, description: id, category: 'web', permissions: ['web'],
  requiredParams: [], optionalParams: [], responseSchema: { type: 'object', fields: {} },
  status: 'active', version: '1.0.0', supportedAgents: [], ...extra,
});

beforeAll(() => {
  ensureBuiltinToolsRegistered();
  toolRegistry.register(baseDef('test.sideEffect'), sideEffectHandler);                       // readOnly absent
  toolRegistry.register(baseDef('test.readOnlyFalse', { readOnly: false }), readOnlyUndefinedHandler);
  toolRegistry.register(baseDef('test.readOnlyTrue', { readOnly: true }), flaggedReadOnlyHandler);
  toolRegistry.register(baseDef('test.memory', { category: 'memory', permissions: ['memory'] }), memoryHandler);
});

beforeEach(() => {
  h.mode = 'sandbox';
  h.webSearch.mockReset();
  h.webSearch.mockResolvedValue(WEB_RESULT);
  sideEffectHandler.mockClear(); readOnlyUndefinedHandler.mockClear(); flaggedReadOnlyHandler.mockClear(); memoryHandler.mockClear();
});

const run = (toolId: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  toolExecutor.execute({ id: 'req-' + Math.random(), toolId, agentId: 'nova', arguments: args, tenantId: 'client-tenant', ...extra } as never);

describe('sandbox: a read-only tool runs for real', () => {
  it('web.search (tenant mode sandbox) calls the real handler once and returns its data, not a simulation', async () => {
    const r = await run('web.search', { query: 'jarvis' });
    expect(h.webSearch).toHaveBeenCalledTimes(1);
    expect(h.webSearch.mock.calls[0][0]).toEqual({ query: 'jarvis' });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual(WEB_RESULT);
    expect(r.simulated).toBeUndefined();
    expect((r.data as { simulated?: boolean }).simulated).toBeUndefined();
  });

  it('reports the TRUE mode: "sandbox" — neither "simulation" nor "live"', async () => {
    const r = await run('web.search', { query: 'jarvis' });
    expect(r.executionMode).toBe('sandbox');
  });

  it('an explicit per-call sandbox mode behaves the same as the tenant default', async () => {
    h.mode = 'live'; // tenant default is overridden by the call
    const r = await run('web.search', { query: 'jarvis' }, { executionMode: 'sandbox' });
    expect(h.webSearch).toHaveBeenCalledTimes(1);
    expect(r.executionMode).toBe('sandbox');
    expect(r.simulated).toBeUndefined();
  });

  it('the real built-in definitions: web.search is the only readOnly tool (every other tool stays fail-safe)', () => {
    const readOnly = toolRegistry.list().filter((t) => t.readOnly === true && !t.id.startsWith('test.')).map((t) => t.id);
    expect(readOnly).toEqual(['web.search']);
  });
});

describe('sandbox: anything with a side effect is still simulated', () => {
  it('a tool with readOnly undefined is NOT read-only: simulated, handler never called', async () => {
    const r = await run('test.sideEffect', { x: 1 });
    expect(sideEffectHandler).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
    expect(r.executionMode).toBe('simulation');
    expect((r.data as { simulated: boolean }).simulated).toBe(true);
  });

  it('readOnly: false is simulated too', async () => {
    const r = await run('test.readOnlyFalse');
    expect(readOnlyUndefinedHandler).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
  });

  it.each([
    ['n8n.deleteWorkflow', { id: 'wf1' }, 'flow'],
    ['n8n.triggerWorkflow', { id: 'wf1' }, 'flow'],
    ['n8n.activateWorkflow', { id: 'wf1' }, 'flow'],
    ['n8n.listWorkflows', {}, 'flow'],          // read-shaped, but deliberately NOT flagged (global n8n instance)
    ['files.write', { path: 'a', content: 'b' }, 'nova'],
    ['google.gmail.send', { to: 'a@b.c', subject: 's', body: 'b' }, 'echo'],
  ])('real built-in %s in sandbox is simulated (the real handler/placeholder is not reached)', async (toolId, args, agentId) => {
    const r = await run(toolId, args, { agentId });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.executionMode).toBe('simulation');
  });
});

describe('explicit simulation still simulates everything, read-only or not', () => {
  it('request.isSimulation on web.search -> simulated, handler not called', async () => {
    const r = await run('web.search', { query: 'jarvis' }, { isSimulation: true });
    expect(h.webSearch).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
    expect(r.executionMode).toBe('simulation');
  });

  it('per-call executionMode "simulation" on web.search -> simulated', async () => {
    const r = await run('web.search', { query: 'jarvis' }, { executionMode: 'simulation' });
    expect(h.webSearch).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
  });

  it('tenant default "simulation" on web.search -> simulated', async () => {
    h.mode = 'simulation';
    const r = await run('web.search', { query: 'jarvis' });
    expect(h.webSearch).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
  });

  it('isSimulation wins even when the tenant is live and the call says sandbox', async () => {
    const r = await run('test.readOnlyTrue', {}, { isSimulation: true, executionMode: 'sandbox' });
    expect(flaggedReadOnlyHandler).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
  });
});

describe('live mode is unchanged', () => {
  it('a read-only tool runs for real and reports "live"', async () => {
    h.mode = 'live';
    const r = await run('web.search', { query: 'jarvis' });
    expect(h.webSearch).toHaveBeenCalledTimes(1);
    expect(r.executionMode).toBe('live');
    expect(r.simulated).toBeUndefined();
  });

  it('a side-effect tool runs for real in live', async () => {
    h.mode = 'live';
    const r = await run('test.sideEffect', { x: 1 });
    expect(sideEffectHandler).toHaveBeenCalledTimes(1);
    expect(r.executionMode).toBe('live');
    expect(r.simulated).toBeUndefined();
  });
});

describe('memory tools: sandbox routing is unchanged', () => {
  it('a memory-category tool in sandbox runs its handler against SANDBOX_TENANT_ID (not simulated, not the client tenant)', async () => {
    const r = await run('test.memory', {}, { agentId: 'echo' });
    expect(memoryHandler).toHaveBeenCalledTimes(1);
    expect((r.data as { tenantSeen: string }).tenantSeen).toBe(SANDBOX_TENANT_ID);
    expect(r.simulated).toBeUndefined();
    expect(r.executionMode).toBe('sandbox');
  });

  it('in live the memory tool sees the real tenant', async () => {
    h.mode = 'live';
    const r = await run('test.memory', {}, { agentId: 'echo' });
    expect((r.data as { tenantSeen: string }).tenantSeen).toBe('client-tenant');
  });

  it('no real memory.* tool is flagged readOnly (their sandbox routing must not change)', () => {
    expect(toolRegistry.list().filter((t) => t.category === 'memory').every((t) => t.readOnly !== true)).toBe(true);
  });
});

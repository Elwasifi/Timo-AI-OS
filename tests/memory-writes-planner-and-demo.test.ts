// M7-13c-2c-b (Part A) — memory WRITES in the planner and in Demo.
//
// Live finding: in Demo (tenants.execution_mode = 'sandbox') every memory.store failed with an RLS 403, because the executor rewrote the
// tenant of memory tools to SANDBOX_TENANT_ID, which has no members (the only INSERT policy is is_tenant_member(tenant_id)). It was
// triggered by the TOOL PLANNER planning memory.store after web.search, not by anything the user asked.
//
// A1  memory WRITE tools are offered to the planner, and executed, ONLY when DetectedIntent.asksToRemember (the detector the explicit
//     "remember that ..." path in memory-decision.ts already uses). Enforced in code in both places.
// A2  in Demo a memory write is a simulation (no DB, no fetch); memory READ tools run for real against the user's own tenant;
//     in live a memory.store still writes to the real tenant.
//
// Real: tool registry + built-in tool definitions, permission engine, ToolPlanner, decideTools, ToolExecutor, detectIntent.
// Stubbed: the model call (planner catalog is captured), the memory service (call counts), the tenant-mode lookup, approvals, fetch, supabase.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'sandbox' as 'live' | 'sandbox' | 'simulation',
  catalogs: [] as string[],
  chat: vi.fn(),
  memoryStore: vi.fn(),
  memorySearch: vi.fn(),
  memoryRecall: vi.fn(),
  memoryTimeline: vi.fn(),
  memoryOther: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('@/lib/ai/ai-provider', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/ai-provider')>();
  return {
    ...actual,
    chatWithFallback: h.chat,
  };
});
vi.mock('@/lib/ai/router', () => ({
  route: vi.fn(async () => ({ candidates: [{ provider: 'groq', model: 'openai/gpt-oss-120b' }], taskType: 'TOOL_EXECUTION', mode: 'automatic' })),
  classifyTask: vi.fn(() => ({ taskType: 'TOOL_EXECUTION', latencySensitivity: 'normal' })),
}));
vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/executionMode')>();
  return { ...actual, getTenantExecutionMode: vi.fn(async () => h.mode) };
});
vi.mock('@/lib/memory/memoryService', () => ({
  memory: {
    store: h.memoryStore,
    search: h.memorySearch,
    recall: h.memoryRecall,
    timeline: h.memoryTimeline,
    forget: h.memoryOther,
    link: h.memoryOther,
    update: h.memoryOther,
    summarize: h.memoryOther,
  },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: (...a: unknown[]) => { h.supabaseFrom(...a); throw new Error('no DB call is allowed in this test'); } },
}));

import { toolRegistry } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { permissionEngine } from '@/lib/tools/permissions';
import { toolPlanner } from '@/lib/tools/planner';
import { toolExecutor } from '@/lib/tools/executor';
import { decideTools } from '@/lib/context/tool-decision';
import { detectIntent } from '@/lib/context/intent-detector';
import { isMemoryWriteTool } from '@/lib/tools/memoryWriteGuard';
import { SANDBOX_TENANT_ID, categoryHasRealSandboxIsolation } from '@/lib/governance/executionMode';
import type { DetectedIntent } from '@/lib/context/types';
import type { Intent } from '@/types';

const TENANT = 'client-tenant';
const AGENT = 'echo';
const routing = { confidence: 0.5 } as unknown as Intent;

const MEMORY_WRITE_IDS = ['memory.link', 'memory.store', 'memory.summarize', 'memory.update'];
const MEMORY_READ_IDS = ['memory.recall', 'memory.search', 'memory.timeline'];

beforeAll(() => { ensureBuiltinToolsRegistered(); });

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  h.mode = 'sandbox';
  h.catalogs.length = 0;
  for (const f of [h.chat, h.memoryStore, h.memorySearch, h.memoryRecall, h.memoryTimeline, h.memoryOther, h.supabaseFrom]) f.mockReset();
  h.chat.mockImplementation(async (_m: unknown, opts: { systemPrompt: string }) => {
    h.catalogs.push(opts.systemPrompt);
    return { content: JSON.stringify({ tools: [], explanation: 'none' }), usage: { inputTokens: 1, outputTokens: 1 }, provider: 'groq', model: 'openai/gpt-oss-120b' };
  });
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => { throw new Error('no network call is allowed in this test'); }) as never;
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Tool ids the planner put in its catalog (the "offered" list). */
const offered = (): string[] => {
  const prompt = h.catalogs[0] ?? '';
  const json = prompt.slice(prompt.indexOf('Available tools:') + 'Available tools:'.length, prompt.indexOf('Respond with ONLY'));
  return (JSON.parse(json) as Array<{ id: string }>).map((t) => t.id);
};

describe('A1 - which memory tools are writes (listed from the real registry)', () => {
  it('the guarded set is exactly store/update/link/summarize; the read tools and the approval-gated forget are not in it', () => {
    const memTools = toolRegistry.list().filter((t) => t.category === 'memory');
    expect(memTools.filter((t) => isMemoryWriteTool(t)).map((t) => t.id).sort()).toEqual(MEMORY_WRITE_IDS);
    expect(memTools.filter((t) => !isMemoryWriteTool(t)).map((t) => t.id).sort()).toEqual([...MEMORY_READ_IDS, 'memory.forget'].sort());
  });
  it('a memory tool added later and not flagged readOnly is guarded by default (fail closed)', () => {
    expect(isMemoryWriteTool({ id: 'memory.brandNew', category: 'memory', readOnly: undefined })).toBe(true);
    expect(isMemoryWriteTool({ id: 'memory.brandNew', category: 'memory', readOnly: true })).toBe(false);
    expect(isMemoryWriteTool({ id: 'web.search', category: 'web', readOnly: undefined })).toBe(false);
  });
});

describe('A1(a) - the OFFERED list: the planner is not shown memory write tools unless the user asked to remember', () => {
  const permissions = () => permissionEngine.getPermissions(AGENT);

  it('no options (default) -> web/read tools offered, NO memory write tool', async () => {
    await toolPlanner.plan('search for open source jarvis', AGENT, permissions(), TENANT);
    const ids = offered();
    expect(ids).toContain('web.search');
    for (const id of MEMORY_WRITE_IDS) expect(ids).not.toContain(id);
    for (const id of MEMORY_READ_IDS) expect(ids).toContain(id);
    expect(ids).toContain('memory.forget');
  });

  it('allowMemoryWrite: false -> same as the default', async () => {
    await toolPlanner.plan('search for open source jarvis', AGENT, permissions(), TENANT, { allowMemoryWrite: false });
    for (const id of MEMORY_WRITE_IDS) expect(offered()).not.toContain(id);
  });

  it('allowMemoryWrite: true -> memory.store (and the other writes) ARE offered', async () => {
    await toolPlanner.plan('search for open source jarvis and remember it', AGENT, permissions(), TENANT, { allowMemoryWrite: true });
    for (const id of [...MEMORY_WRITE_IDS, ...MEMORY_READ_IDS]) expect(offered()).toContain(id);
  });

  it('decideTools passes the intent through: an English search turn offers no write tool; a "remember" turn offers them', async () => {
    const searchIntent = detectIntent('search for open source jarvis', routing);
    expect(searchIntent.asksToRemember).toBe(false);
    await decideTools('search for open source jarvis', searchIntent, AGENT, TENANT);
    for (const id of MEMORY_WRITE_IDS) expect(offered()).not.toContain(id);

    h.catalogs.length = 0;
    const rememberIntent = detectIntent('search for open source jarvis and remember that I like it', routing);
    expect(rememberIntent.asksToRemember).toBe(true);
    expect(rememberIntent.asksForToolAction).toBe(true);
    await decideTools('search for open source jarvis and remember that I like it', rememberIntent, AGENT, TENANT);
    for (const id of MEMORY_WRITE_IDS) expect(offered()).toContain(id);
  });

  it('Arabic: a web-search request ("ابحث عن ...") is a tool turn that does NOT ask to remember -> no write tool offered', async () => {
    const text = 'ابحث عن افضل مكتبة مفتوحة المصدر للمساعدين';
    const intent = detectIntent(text, routing);
    expect(intent.asksForToolAction).toBe(true);
    expect(intent.toolCategoryHint).toBe('web');
    expect(intent.asksToRemember).toBe(false);
    await decideTools(text, intent, AGENT, TENANT);
    for (const id of MEMORY_WRITE_IDS) expect(offered()).not.toContain(id);
  });
});

describe('A1(b) - the EXECUTED list: a planned memory write is dropped before execution unless the user asked to remember', () => {
  // The planner itself is stubbed here so a memory write reaches decideTools() even though the real planner would not have offered it:
  // this block tests the SECOND guard (the executed list) on its own.
  const planWith = (...calls: Array<{ toolId: string; arguments: Record<string, unknown> }>) =>
    vi.spyOn(toolPlanner, 'plan').mockResolvedValue({ tools: calls, explanation: 'x' } as never);
  const runs = () => vi.mocked(toolExecutor.execute).mock.calls.map((c) => (c[0] as { toolId: string }).toolId);

  beforeEach(() => {
    vi.spyOn(toolExecutor, 'execute').mockImplementation(async (req) => ({ ok: true, toolId: req.toolId, requestId: req.id, agentId: req.agentId, data: { summary: 'done' }, durationMs: 1, retries: 0, streaming: false, timestamp: 1 }) as never);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  // The model is stubbed to ignore the offered list and plan a write anyway (the worst case): the code guard must still drop it.
  const stubIntent = (over: Partial<DetectedIntent>): DetectedIntent =>
    ({ asksForToolAction: true, toolCategoryHint: 'web', asksAboutTimeline: false, asksAboutMemory: false, asksToRemember: false, ...over }) as unknown as DetectedIntent;

  it('English search turn, the model plans web.search + memory.store -> only web.search runs', async () => {
    planWith({ toolId: 'web.search', arguments: { query: 'jarvis' } }, { toolId: 'memory.store', arguments: { title: 't', content: 'c' } });
    const r = await decideTools('search for jarvis', stubIntent({}), AGENT, TENANT);
    expect(runs()).toEqual(['web.search']);
    expect(r.executions.map((e) => e.toolId)).toEqual(['web.search']);
  });

  it('every memory write tool is dropped, not just memory.store', async () => {
    planWith(
      { toolId: 'memory.store', arguments: { title: 't', content: 'c' } },
      { toolId: 'memory.update', arguments: { id: 'x' } },
      { toolId: 'memory.link', arguments: { sourceId: 'a', targetId: 'b' } },
      { toolId: 'memory.summarize', arguments: { id: 'x' } },
      { toolId: 'web.search', arguments: { query: 'q' } },
    );
    await decideTools('search for jarvis', stubIntent({}), AGENT, TENANT);
    expect(runs()).toEqual(['web.search']);
  });

  it('memory READ tools in the plan are unaffected', async () => {
    planWith({ toolId: 'memory.search', arguments: { query: 'jarvis' } }, { toolId: 'memory.timeline', arguments: {} });
    await decideTools('show my memories', stubIntent({ toolCategoryHint: 'memory' }), AGENT, TENANT);
    expect(runs()).toEqual(['memory.search', 'memory.timeline']);
  });

  it('Arabic search turn: the planned memory.store is dropped too', async () => {
    const text = 'ابحث عن اخبار الذكاء الاصطناعي';
    planWith({ toolId: 'web.search', arguments: { query: 'اخبار' } }, { toolId: 'memory.store', arguments: { title: 't', content: 'c' } });
    await decideTools(text, detectIntent(text, routing), AGENT, TENANT);
    expect(runs()).toEqual(['web.search']);
  });

  it('English "remember" turn: the planned memory.store IS executed', async () => {
    const text = 'search for jarvis and remember that I like it';
    planWith({ toolId: 'web.search', arguments: { query: 'jarvis' } }, { toolId: 'memory.store', arguments: { title: 't', content: 'c' } });
    await decideTools(text, detectIntent(text, routing), AGENT, TENANT);
    expect(runs()).toEqual(['web.search', 'memory.store']);
  });

  it('a dropped write never reaches the executor even when it is the ONLY planned tool', async () => {
    planWith({ toolId: 'memory.store', arguments: { title: 't', content: 'c' } });
    const r = await decideTools('search for jarvis', stubIntent({}), AGENT, TENANT);
    expect(runs()).toEqual([]);
    expect(r.success).toBe(false);
  });
});

describe('A2 - Demo (sandbox) memory: writes are simulated, reads run for real on the user\'s own tenant', () => {
  const exec = (toolId: string, args: Record<string, unknown>) =>
    toolExecutor.execute({ id: 'req-' + Math.random(), toolId, agentId: AGENT, arguments: args, tenantId: TENANT } as never);
  const noExternalCalls = () => {
    expect(h.supabaseFrom).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  };

  it('no category has a "real sandbox isolation" tenant any more (memory was the only one)', () => {
    expect(categoryHasRealSandboxIsolation('memory')).toBe(false);
  });

  it('sandbox memory.store is a SIMULATION: flagged simulated, the memory service is never called, zero DB/fetch calls', async () => {
    const r = await exec('memory.store', { title: 'Jarvis', content: 'user likes jarvis' });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.executionMode).toBe('simulation');
    expect((r.data as { simulated: boolean; note: string }).simulated).toBe(true);
    expect((r.data as { note: string }).note).toMatch(/Simulated execution of "memory\.store"/);
    expect(h.memoryStore).not.toHaveBeenCalled();
    noExternalCalls();
  });

  it('the same holds for update / link / summarize in sandbox', async () => {
    for (const [id, args] of [['memory.update', { id: 'x' }], ['memory.link', { sourceId: 'a', targetId: 'b' }], ['memory.summarize', { id: 'x' }]] as const) {
      const r = await exec(id, args as Record<string, unknown>);
      expect(r.simulated).toBe(true);
    }
    expect(h.memoryOther).not.toHaveBeenCalled();
    noExternalCalls();
  });

  it('sandbox memory.search runs for real against the user\'s OWN tenant (never SANDBOX_TENANT_ID)', async () => {
    h.memorySearch.mockResolvedValue([{ id: '1', title: 'Jarvis' }]);
    const r = await exec('memory.search', { query: 'jarvis' });
    expect(r.simulated).toBeUndefined();
    expect(r.executionMode).toBe('sandbox');
    expect(h.memorySearch).toHaveBeenCalledTimes(1);
    expect(h.memorySearch.mock.calls[0][0].tenantId).toBe(TENANT);
    expect(h.memorySearch.mock.calls[0][0].tenantId).not.toBe(SANDBOX_TENANT_ID);
  });

  it('sandbox memory.recall and memory.timeline also run for real', async () => {
    h.memoryRecall.mockResolvedValue({ id: '1', title: 'T' });
    h.memoryTimeline.mockResolvedValue([]);
    const a = await exec('memory.recall', { id: '1' });
    const b = await exec('memory.timeline', {});
    expect(a.simulated).toBeUndefined();
    expect(b.simulated).toBeUndefined();
    expect(h.memoryRecall).toHaveBeenCalledTimes(1);
    expect(h.memoryTimeline).toHaveBeenCalledTimes(1);
  });

  it('LIVE memory.store still writes, to the REAL tenant', async () => {
    h.mode = 'live';
    h.memoryStore.mockResolvedValue({ id: 'new', type: 'long_term', importance: 'medium' });
    const r = await exec('memory.store', { title: 'Jarvis', content: 'user likes jarvis' });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBeUndefined();
    expect(r.executionMode).toBe('live');
    expect(h.memoryStore).toHaveBeenCalledTimes(1);
    expect(h.memoryStore.mock.calls[0][0].tenantId).toBe(TENANT);
    expect(h.memoryStore.mock.calls[0][0].tenantId).not.toBe(SANDBOX_TENANT_ID);
  });

  it('explicit per-call simulation still simulates memory reads too (unchanged)', async () => {
    const r = await toolExecutor.execute({ id: 'x', toolId: 'memory.search', agentId: AGENT, arguments: { query: 'q' }, tenantId: TENANT, isSimulation: true } as never);
    expect(r.simulated).toBe(true);
    expect(h.memorySearch).not.toHaveBeenCalled();
  });
});

describe('the explicit "remember that ..." path (memory-decision.ts) is untouched: real tenant, no executor, no sandbox rewrite', () => {
  it('decideMemory stores through knowledge/memory with the caller\'s tenantId, never via the tool executor', async () => {
    vi.resetModules();
    const knowledgeStore = vi.fn(async () => ({ facts: [{ id: 'f' }], conflicts: [], semanticMemoryId: 'm1' }));
    vi.doMock('@/lib/knowledge/engine', () => ({ knowledge: { store: knowledgeStore, search: vi.fn(), timeline: vi.fn() } }));
    vi.doMock('@/lib/memory/memorySettings', () => ({ loadMemorySettings: async () => null }));
    const exec = vi.spyOn(toolExecutor, 'execute');
    const { decideMemory } = await import('@/lib/context/memory-decision');
    const intent = detectIntent('remember that my favorite IDE is VS Code', routing);
    expect(intent.asksToRemember).toBe(true);
    const r = await decideMemory('remember that my favorite IDE is VS Code', intent, 'temo', TENANT);
    expect(r.wasStored).toBe(true);
    expect(knowledgeStore).toHaveBeenCalledTimes(1);
    expect((knowledgeStore.mock.calls[0] as unknown[])[0]).toMatchObject({ tenantId: TENANT });
    expect(exec).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/knowledge/engine');
    vi.doUnmock('@/lib/memory/memorySettings');
  });
});

// M7-13e: regression guards for the "chat hangs forever / failing provider
// chain" ticket. All unit-level with stubbed network — no live Supabase or
// provider calls — so they are deterministic and cost nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTimeoutFetch,
  timeoutForUrl,
  SupabaseTimeoutError,
  AUTH_TIMEOUT_MS,
  REST_TIMEOUT_MS,
  FUNCTIONS_TIMEOUT_MS,
} from '@/lib/supabase/timeoutFetch';
import { failurePenalty } from '@/lib/ai/router/scoring';
import { isProvenHealth } from '@/lib/ai/router/healthTracker';
import type { ModelHealth } from '@/lib/ai/router/types';

const health = (over: Partial<ModelHealth>): ModelHealth => ({
  provider: 'groq',
  modelId: 'm',
  successCount: 0,
  failureCount: 0,
  consecutiveFailures: 0,
  avgLatencyMs: null,
  lastSuccessAt: null,
  lastFailureAt: new Date().toISOString(),
  lastStatusCode: null,
  ...over,
});

describe('timeoutFetch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('maps URL kinds to the ticket ceilings (auth 10s, REST 15s, functions 20s)', () => {
    expect(timeoutForUrl('https://x.supabase.co/auth/v1/token')).toBe(AUTH_TIMEOUT_MS);
    expect(timeoutForUrl('https://x.supabase.co/rest/v1/missions?select=*')).toBe(REST_TIMEOUT_MS);
    expect(timeoutForUrl('https://x.supabase.co/functions/v1/ai-chat')).toBe(FUNCTIONS_TIMEOUT_MS);
    expect([AUTH_TIMEOUT_MS, REST_TIMEOUT_MS, FUNCTIONS_TIMEOUT_MS]).toEqual([10_000, 15_000, 20_000]);
  });

  it('rejects a never-resolving REST request with a typed SupabaseTimeoutError after 15s — even if fetch ignores the abort signal', async () => {
    const neverResolves = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const f = createTimeoutFetch(neverResolves);
    const p = f('https://x.supabase.co/rest/v1/provider_model_catalog');
    const assertion = expect(p).rejects.toBeInstanceOf(SupabaseTimeoutError);
    await vi.advanceTimersByTimeAsync(REST_TIMEOUT_MS + 1);
    await assertion;
  });

  it('does not fire early: a request that answers at 14.9s succeeds', async () => {
    const slow = vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('ok')), 14_900))) as unknown as typeof fetch;
    const f = createTimeoutFetch(slow);
    const p = f('https://x.supabase.co/rest/v1/x');
    await vi.advanceTimersByTimeAsync(14_901);
    expect((await p).status).toBe(200);
  });

  it('honors a caller-supplied AbortSignal', async () => {
    const abortAware = vi.fn((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    ) as unknown as typeof fetch;
    const f = createTimeoutFetch(abortAware);
    const ac = new AbortController();
    const p = f('https://x.supabase.co/rest/v1/x', { signal: ac.signal });
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    ac.abort();
    await assertion;
  });
});

describe('router failurePenalty (M7-13b regression found in M7-13e)', () => {
  it('a permanently broken model (0 successes) gets the FULL penalty no matter how many failures it piles up', () => {
    const few = failurePenalty(health({ failureCount: 3, consecutiveFailures: 3 }));
    const many = failurePenalty(health({ failureCount: 100, consecutiveFailures: 100 }));
    expect(few).toBe(1);
    expect(many).toBe(1); // used to shrink to ~0.1 as failureCount grew -> broken providers retried MORE
  });

  it('still forgives a couple of recent misses for a model with a long success record (allam: 194 ok, 2 consecutive failures)', () => {
    expect(failurePenalty(health({ successCount: 194, failureCount: 2, consecutiveFailures: 2 }))).toBeLessThan(0.06);
  });
});

describe('isProvenHealth', () => {
  it('needs >=3 successes and >=50% success rate', () => {
    expect(isProvenHealth(null)).toBe(false);
    expect(isProvenHealth(health({ successCount: 2 }))).toBe(false);
    expect(isProvenHealth(health({ successCount: 3, failureCount: 4 }))).toBe(false);
    expect(isProvenHealth(health({ successCount: 14, failureCount: 1 }))).toBe(true);
  });
});

// ---- ai-provider: circuit breaker, ordering, per-provider timeout ----

const healthRows = new Map<string, ModelHealth>();
vi.mock('@/lib/ai/router/healthTracker', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/router/healthTracker')>();
  return {
    ...actual,
    getAllHealth: async () => healthRows,
    getHealth: async (p: string, m: string) => healthRows.get(`${p}::${m}`) ?? null,
    recordHealth: vi.fn(),
  };
});
vi.mock('@/lib/ai/usageLedger', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/governance/entitlements', () => ({ checkBudget: vi.fn(async () => ({ withinBudget: true, spendUsd: 0, limitUsd: null })) }));
// Client tenants (non-internal ids) resolve their providers from tenant_provider_keys; here every provider is "configured" so these tests exercise timeouts/ordering, not BYOK (covered in router-byok.test.ts).
const tenantCfg = vi.hoisted(() => ({ providers: ['groq', 'gemini', 'nvidia', 'openrouter'] as string[], pinned: {} as Record<string, string> }));
vi.mock('@/lib/settings/tenantConfiguredProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/tenantConfiguredProviders')>();
  return {
    ...actual,
    loadTenantProviderConfig: async () =>
      tenantCfg.providers.map((provider) => ({ provider: provider as 'groq', model: tenantCfg.pinned[provider] ?? null })),
  };
});
vi.mock('@/lib/settings/settings-service', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/settings-service')>();
  return {
    ...actual,
    loadSettings: async () => ({
      ...actual.DEFAULT_SETTINGS,
      active_provider: 'groq',
      groq_api_key: 'k', gemini_api_key: 'k', nvidia_api_key: 'k', openrouter_api_key: 'k',
    }),
  };
});

import {
  tripCircuitIfHardFailure,
  isCircuitOpen,
  resetProviderCircuits,
  prioritizePairs,
  chatWithFallback,
  CIRCUIT_COOLDOWN_MS,
  requestTimeoutFor,
  LONG_GENERATION_TIMEOUT_MS,
  LARGE_OUTPUT_TIMEOUT_MS,
  PROVIDER_REQUEST_TIMEOUT_MS,
  INTERACTIVE_DEADLINE_MS,
  isInteractiveCall,
  streamWithFallback,
} from '@/lib/ai/ai-provider';
import { recordHealth } from '@/lib/ai/router/healthTracker';

const setHealth = (provider: string, modelId: string, over: Partial<ModelHealth>) =>
  healthRows.set(`${provider}::${modelId}`, health({ provider: provider as ModelHealth['provider'], modelId, ...over }));

describe('circuit breaker', () => {
  beforeEach(() => { resetProviderCircuits(); healthRows.clear(); });

  it('opens on 404/410 for that model only, and on 401/403 for the whole provider; ignores transient statuses', () => {
    expect(tripCircuitIfHardFailure(null, 'nvidia', 'meta/llama-3.1-405b-instruct', 404)).toBe(true);
    expect(isCircuitOpen(null, 'nvidia', 'meta/llama-3.1-405b-instruct')).toBe(true);
    expect(isCircuitOpen(null, 'nvidia', 'some/other-model')).toBe(false);

    expect(tripCircuitIfHardFailure(null, 'gemini', 'g-1', 401)).toBe(true);
    expect(isCircuitOpen(null, 'gemini', 'anything-at-all')).toBe(true);

    for (const transient of [429, 500, 502, 503, 504, 408, 0, 200]) {
      expect(tripCircuitIfHardFailure(null, 'groq', 'm', transient)).toBe(false);
    }
    expect(isCircuitOpen(null, 'groq', 'm')).toBe(false);
  });

  it('stays open for exactly the 30-minute cooldown, and resetProviderCircuits clears it (key re-saved)', () => {
    expect(CIRCUIT_COOLDOWN_MS).toBe(30 * 60 * 1000);
    tripCircuitIfHardFailure(null, 'nvidia', 'm', 404);
    const now = Date.now();
    expect(isCircuitOpen(null, 'nvidia', 'm', now + CIRCUIT_COOLDOWN_MS - 1000)).toBe(true);
    expect(isCircuitOpen(null, 'nvidia', 'm', now + CIRCUIT_COOLDOWN_MS + 1000)).toBe(false);
    resetProviderCircuits(null, 'nvidia');
    expect(isCircuitOpen(null, 'nvidia', 'm')).toBe(false);
  });
});

describe('prioritizePairs — proven -> unproven -> never-worked -> open-circuit', () => {
  beforeEach(() => { resetProviderCircuits(); healthRows.clear(); });
  const pairs = [
    { providerId: 'nvidia' as const, model: 'n' },
    { providerId: 'gemini' as const, model: 'g' },
    { providerId: 'groq' as const, model: 'q' },
    { providerId: 'openrouter' as const, model: 'o' },
  ];

  it('default chain: proven first (fastest expected answer first), unproven next, never-worked pair dropped', async () => {
    setHealth('groq', 'q', { successCount: 14, failureCount: 1, avgLatencyMs: 1000 });
    setHealth('gemini', 'g', { successCount: 123, failureCount: 1, avgLatencyMs: 4700 });
    setHealth('nvidia', 'n', { successCount: 0, failureCount: 5, consecutiveFailures: 5 });
    // openrouter/o: no health row at all -> unproven (kept, after the proven ones)
    const out = await prioritizePairs(pairs, false);
    expect(out.lastResort).toBe(false);
    expect(out.pairs.map((p) => p.providerId)).toEqual(['groq', 'gemini', 'openrouter']);
  });

  it('a provider with zero successes across ALL its models is treated as never-worked', async () => {
    setHealth('nvidia', 'other', { successCount: 0, failureCount: 3 });
    setHealth('groq', 'q', { successCount: 10, failureCount: 0, avgLatencyMs: 900 });
    const out = await prioritizePairs(pairs, false);
    expect(out.pairs.map((p) => p.providerId)).not.toContain('nvidia');
  });

  it('open circuits are dropped while healthy alternatives exist', async () => {
    tripCircuitIfHardFailure(null, 'groq', 'q', 404);
    const out = await prioritizePairs(pairs, false);
    expect(out.pairs.map((p) => p.providerId)).not.toContain('groq');
  });

  it('last resort: when EVERYTHING looks broken it still returns attempts (never-worked before open-circuit) instead of nothing', async () => {
    const two = [pairs[0], pairs[2]];
    setHealth('nvidia', 'n', { successCount: 0, failureCount: 5 });
    tripCircuitIfHardFailure(null, 'groq', 'q', 404);
    const out = await prioritizePairs(two, false);
    expect(out.lastResort).toBe(true);
    expect(out.pairs.map((p) => p.providerId)).toEqual(['nvidia', 'groq']);
  });

  it("router candidates keep the router's own order (an unproven top pick for mission work is NOT demoted)", async () => {
    setHealth('groq', 'q', { successCount: 50, failureCount: 0, avgLatencyMs: 800 });
    const out = await prioritizePairs([pairs[3], pairs[2]], true); // openrouter (unproven) first, groq (proven) second
    expect(out.pairs.map((p) => p.providerId)).toEqual(['openrouter', 'groq']);
  });
});

describe('chatWithFallback — a stalled provider no longer hangs the chain', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.useFakeTimers(); resetProviderCircuits(); healthRows.clear(); });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

  it('times a stalled provider out after PROVIDER_REQUEST_TIMEOUT_MS (no retry) and answers from the next one', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push(body.provider);
      if (body.provider === 'groq') {
        // stalls forever, but respects abort like a real fetch
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ content: 'hello', usage: { inputTokens: 1, outputTokens: 1 }, model: 'g' }), { status: 200 }));
    }) as unknown as typeof fetch;

    setHealth('groq', 'openai/gpt-oss-120b', { successCount: 14, failureCount: 1, avgLatencyMs: 1000 });
    setHealth('gemini', 'gemini-3.1-flash-lite-preview', { successCount: 123, failureCount: 1, avgLatencyMs: 4700 });

    const p = chatWithFallback([{ role: 'user', content: 'hi' }], {});
    await vi.advanceTimersByTimeAsync(PROVIDER_REQUEST_TIMEOUT_MS + 100);
    const result = await p;

    expect(result.content).toBe('hello');
    expect(seen).toEqual(['groq', 'gemini']); // groq tried exactly once (408 is not retried), then gemini
  });

  it('a 404 provider is tried once, then skipped on the next call (circuit open)', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.provider);
      if (body.provider === 'groq') return new Response(JSON.stringify({ error: 'model_not_found' }), { status: 404 });
      return new Response(JSON.stringify({ content: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, model: 'g' }), { status: 200 });
    }) as unknown as typeof fetch;

    setHealth('groq', 'openai/gpt-oss-120b', { successCount: 14, failureCount: 1, avgLatencyMs: 1000 });
    setHealth('gemini', 'gemini-3.1-flash-lite-preview', { successCount: 123, failureCount: 1, avgLatencyMs: 4700 });

    await chatWithFallback([{ role: 'user', content: 'one' }], {});
    await chatWithFallback([{ role: 'user', content: 'two' }], {});
    expect(calls).toEqual(['groq', 'gemini', 'gemini']); // second call never touched groq
  });
});

describe('circuit breaker is tenant-scoped (no cross-tenant leak)', () => {
  beforeEach(() => { resetProviderCircuits(); healthRows.clear(); });

  it("tenant A's rejected key (401) does not open the provider for tenant B or the internal bucket", () => {
    tripCircuitIfHardFailure('tenant-A', 'groq', 'm', 401);
    expect(isCircuitOpen('tenant-A', 'groq', 'any')).toBe(true);
    expect(isCircuitOpen('tenant-B', 'groq', 'any')).toBe(false);
    expect(isCircuitOpen(null, 'groq', 'any')).toBe(false);
  });

  it("saving tenant A's key clears only tenant A's circuit", () => {
    tripCircuitIfHardFailure('tenant-A', 'groq', 'm', 401);
    tripCircuitIfHardFailure('tenant-B', 'groq', 'm', 401);
    resetProviderCircuits('tenant-A', 'groq');
    expect(isCircuitOpen('tenant-A', 'groq', 'm')).toBe(false);
    expect(isCircuitOpen('tenant-B', 'groq', 'm')).toBe(true);
  });

  it('prioritizePairs only sees the calling tenant\'s open circuits', async () => {
    const two = [{ providerId: 'groq' as const, model: 'q' }, { providerId: 'gemini' as const, model: 'g' }];
    tripCircuitIfHardFailure('tenant-A', 'groq', 'q', 404);
    expect((await prioritizePairs(two, false, 'tenant-A')).pairs.map((p) => p.providerId)).toEqual(['gemini']);
    expect((await prioritizePairs(two, false, 'tenant-B')).pairs.map((p) => p.providerId)).toEqual(['groq', 'gemini']);
  });
});

describe('requestTimeoutFor — limit depends on the call type', () => {
  it('short chat / intent / memory calls get 20s', () => {
    expect(requestTimeoutFor({})).toBe(20_000);
    expect(requestTimeoutFor({ maxTokens: 500, usageContext: { operation: 'intent_classification' } })).toBe(20_000);
    expect(requestTimeoutFor({ usageContext: { operation: 'chat' } })).toBe(20_000);
  });

  it('mission execution, delegation and tool loops get 90s', () => {
    for (const operation of ['mission_task', 'worker_execution', 'manager_review', 'chat_tool_loop']) {
      expect(requestTimeoutFor({ usageContext: { operation } }), operation).toBe(LONG_GENERATION_TIMEOUT_MS);
    }
    expect(LONG_GENERATION_TIMEOUT_MS).toBe(90_000);
  });

  it('a large maxTokens (long draft) gets 60s; an explicit timeoutMs always wins', () => {
    expect(requestTimeoutFor({ maxTokens: 4096 })).toBe(LARGE_OUTPUT_TIMEOUT_MS);
    expect(requestTimeoutFor({ maxTokens: 4096, timeoutMs: 5_000 })).toBe(5_000);
  });
});

describe('chatWithFallback — a long mission_task generation is NOT cut off at 20s', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.useFakeTimers(); resetProviderCircuits(); healthRows.clear(); });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

  it('a provider that answers after 45s succeeds for mission_task (and would have timed out as plain chat)', async () => {
    globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response(JSON.stringify({ content: 'long draft', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' }), { status: 200 })), 45_000);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      }),
    ) as unknown as typeof fetch;

    const p = chatWithFallback([{ role: 'user', content: 'plan' }], { usageContext: { operation: 'mission_task', tenantId: 't' } });
    await vi.advanceTimersByTimeAsync(45_100);
    expect((await p).content).toBe('long draft');
  });
});

describe('interactive overall deadline (30s) — clearly below the 40s chat watchdog', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.useFakeTimers(); resetProviderCircuits(); healthRows.clear(); });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

  const stallingFetch = (log: Array<{ provider: string; at: number }>) =>
    vi.fn((_u: unknown, init?: RequestInit) => {
      log.push({ provider: JSON.parse(String(init?.body)).provider, at: Date.now() });
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      );
    }) as unknown as typeof fetch;

  it('chat with every provider stalling ends with a typed deadline error at <=30s (not 20s x N), and caps each attempt to the time remaining', async () => {
    const log: Array<{ provider: string; at: number }> = [];
    globalThis.fetch = stallingFetch(log);
    setHealth('groq', 'openai/gpt-oss-120b', { successCount: 14, failureCount: 1, avgLatencyMs: 1000 });
    setHealth('gemini', 'gemini-3.1-flash-lite-preview', { successCount: 123, failureCount: 1, avgLatencyMs: 4700 });

    const t0 = Date.now();
    const p = chatWithFallback([{ role: 'user', content: 'hi' }], { usageContext: { operation: 'chat', tenantId: null } });
    const assertion = expect(p).rejects.toMatchObject({ name: 'AIProviderError', code: 'deadline', status: 408 });
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;

    expect(INTERACTIVE_DEADLINE_MS).toBe(30_000);
    expect(log.map((l) => l.provider)).toEqual(['groq', 'gemini']);           // 2nd attempt got only the remaining ~10s, a 3rd was never started
    expect(Date.now() - t0).toBeLessThan(40_000);                              // strictly below the page watchdog
    await expect(p).rejects.toThrow(/taking too long/i);
  });

  it('a long mission_task generation is NOT subject to the interactive deadline (still waiting at 31s, 90s limit unchanged)', async () => {
    const log: Array<{ provider: string; at: number }> = [];
    globalThis.fetch = stallingFetch(log);
    let settled = false;
    const p = chatWithFallback([{ role: 'user', content: 'plan' }], { usageContext: { operation: 'mission_task', tenantId: 't' } });
    p.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(settled).toBe(false);                                               // interactive calls would have been rejected by now
    expect(isInteractiveCall({ usageContext: { operation: 'mission_task' } })).toBe(false);
    expect(isInteractiveCall({ usageContext: { operation: 'chat' } })).toBe(true);
    expect(requestTimeoutFor({ usageContext: { operation: 'mission_task' } })).toBe(90_000);
    await vi.advanceTimersByTimeAsync(100_000);                                // let it finish so no timers leak
  });
});

describe('last-resort tier: a BYOK tenant other configured providers after the router candidates', () => {
  const realFetch = globalThis.fetch;
  const TENANT = 'byok-tenant';
  const routed = [
    { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
    { provider: 'gemini' as const, model: 'gemini-3.1-flash-lite-preview' },
    { provider: 'gemini' as const, model: 'gemini-flash-lite-latest' },
  ];
  beforeEach(() => {
    resetProviderCircuits(); healthRows.clear();
    tenantCfg.providers = ['groq', 'gemini', 'openrouter'];   // Amro-like: openrouter configured but never routed
    tenantCfg.pinned = {};
  });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

  const scripted = (fail: Set<string>, log: Array<{ provider: string; model: string }>) =>
    vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      log.push({ provider: body.provider, model: body.model });
      if (fail.has(body.provider)) return new Response(JSON.stringify({ error: 'model_not_found' }), { status: 404 });
      return new Response(JSON.stringify({ content: 'from ' + body.provider, usage: { inputTokens: 1, outputTokens: 1 }, model: body.model }), { status: 200 });
    }) as unknown as typeof fetch;

  it('groq + both gemini candidates failing leads to an attempt on openrouter (the tenant provider default model)', async () => {
    const log: Array<{ provider: string; model: string }> = [];
    globalThis.fetch = scripted(new Set(['groq', 'gemini']), log);
    const r = await chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    expect(r.content).toBe('from openrouter');
    expect(log.map((l) => l.provider)).toEqual(['groq', 'gemini', 'gemini', 'openrouter']); // router order first, extras last
    expect(log[3].model).toBe('meta-llama/llama-3.3-70b-instruct');                          // DEFAULT_SETTINGS.openrouter_model
  });

  it('uses the tenant pinned model for the extra provider when one is set', async () => {
    tenantCfg.pinned = { openrouter: 'tenant/pinned-model' };
    const log: Array<{ provider: string; model: string }> = [];
    globalThis.fetch = scripted(new Set(['groq', 'gemini']), log);
    await chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    expect(log[log.length - 1]).toEqual({ provider: 'openrouter', model: 'tenant/pinned-model' });
  });

  it('never tries an extra provider whose circuit is open for that tenant', async () => {
    tripCircuitIfHardFailure(TENANT, 'openrouter', 'x', 401);   // this tenant openrouter key was rejected
    const log: Array<{ provider: string; model: string }> = [];
    globalThis.fetch = scripted(new Set(['groq', 'gemini']), log);
    await expect(
      chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } }),
    ).rejects.toThrow();
    // exact sequence: every router candidate was tried, and openrouter (circuit open for this tenant) was NOT appended
    // (contrast: the first test in this block shows the same setup WITHOUT the open circuit ends with 'openrouter')
    expect(log.map((l) => l.provider)).toEqual(['groq', 'gemini', 'gemini']);
  });

  it('a working router candidate means the extras are never touched', async () => {
    const log: Array<{ provider: string; model: string }> = [];
    globalThis.fetch = scripted(new Set(), log);
    await chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    expect(log.map((l) => l.provider)).toEqual(['groq']);
  });

  it('still respects the 30s interactive deadline: the extra tier is not attempted once the budget is spent', async () => {
    vi.useFakeTimers();
    const log: Array<{ provider: string }> = [];
    // groq fails instantly (404); every other provider stalls until aborted.
    globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => {
      const provider = JSON.parse(String(init?.body)).provider as string;
      log.push({ provider });
      if (provider === 'groq') return Promise.resolve(new Response(JSON.stringify({ error: 'model_not_found' }), { status: 404 }));
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }) as unknown as typeof fetch;
    const p = chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    const assertion = expect(p).rejects.toMatchObject({ code: 'deadline' });
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    // groq (instant 404) -> gemini #1 (stalls its 20s cap) -> gemini #2 (gets only the ~10s left) -> budget spent:
    // openrouter IS in the chain (see the first test) but is never started.
    expect(log.map((l) => l.provider)).toEqual(['groq', 'gemini', 'gemini']);
  });

  it('internal tenant is unchanged: router candidates only, no extra providers appended', async () => {
    const log: Array<{ provider: string; model: string }> = [];
    globalThis.fetch = scripted(new Set(['groq', 'gemini']), log);
    await expect(
      chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: '00000000-0000-0000-0000-000000000001' } }),
    ).rejects.toThrow();
    expect(log.map((l) => l.provider)).toEqual(['groq', 'gemini', 'gemini']);
  });
});

describe('429 handling: a provider rate limit moves on to the next candidate; only the edge IP-level gate stops the chain', () => {
  const realFetch = globalThis.fetch;
  const TENANT = 'byok-429';
  const routed = [
    { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
    { provider: 'gemini' as const, model: 'gemini-3.1-flash-lite-preview' },
    { provider: 'gemini' as const, model: 'gemini-flash-lite-latest' },
  ];
  beforeEach(() => {
    vi.useFakeTimers();
    resetProviderCircuits(); healthRows.clear();
    vi.mocked(recordHealth).mockClear();
    tenantCfg.providers = ['groq', 'gemini', 'openrouter'];
    tenantCfg.pinned = {};
  });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

  // A provider own 429, exactly as the edge function returns it: jsonError(status, message) -> { error } with NO code field.
  const providerRateLimit = () => new Response(JSON.stringify({ error: 'Groq API error (429): Rate limit reached' }), { status: 429 });
  // The edge function IP-level gate (supabase/functions/ai-chat/index.ts checkIpRateLimit): the ONLY response carrying code rate_limited.
  const ipGate = () => new Response(JSON.stringify({ error: 'Too many requests. Try again in 5s.', code: 'rate_limited' }), { status: 429 });
  const okFor = (provider: string, model: string) =>
    new Response(JSON.stringify({ content: 'from ' + provider, usage: { inputTokens: 1, outputTokens: 1 }, model }), { status: 200 });
  const scripted = (rules: Record<string, () => Response>, log: string[]) =>
    vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      log.push(body.provider);
      return rules[body.provider] ? rules[body.provider]() : okFor(body.provider, body.model);
    }) as unknown as typeof fetch;

  it('groq 429 -> gemini success: the chain continues, and the groq failure is recorded with status 429', async () => {
    const log: string[] = [];
    globalThis.fetch = scripted({ groq: providerRateLimit }, log);
    const p = chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    await vi.advanceTimersByTimeAsync(5_000);     // the existing retry/backoff for a retryable 429 (1s + 2s) elapses
    const r = await p;
    expect(r.content).toBe('from gemini');
    expect(log).toEqual(['groq', 'groq', 'groq', 'gemini']);   // 3 attempts at the rate-limited provider (existing behavior), then the next candidate
    expect(recordHealth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'groq', modelId: 'openai/gpt-oss-120b', success: false, statusCode: 429 }));
    expect(recordHealth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', success: true }));
  });

  it('Amro chain: groq + both gemini candidates rate-limited -> the last-resort openrouter answers', async () => {
    const log: string[] = [];
    globalThis.fetch = scripted({ groq: providerRateLimit, gemini: providerRateLimit }, log);
    const p = chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    await vi.advanceTimersByTimeAsync(15_000);
    const r = await p;
    expect(r.content).toBe('from openrouter');
    expect(log).toEqual(['groq', 'groq', 'groq', 'gemini', 'gemini', 'gemini', 'gemini', 'gemini', 'gemini', 'openrouter']);
  });

  it('the edge IP-level gate (body code rate_limited) aborts the chain after ONE request, with its own message', async () => {
    const log: string[] = [];
    globalThis.fetch = scripted({ groq: ipGate }, log);
    const p = chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT } });
    const assertion = expect(p).rejects.toThrow(/Too many requests/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(log).toEqual(['groq']);   // every provider shares that gate, so trying the rest would only repeat the block
  });

  it('streamWithFallback: groq 429 -> gemini streams the answer', async () => {
    const log: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      log.push(body.provider);
      if (body.provider === 'groq') return providerRateLimit();
      const ndjson = ['{"delta":"hello "}', '{"delta":"world"}', '{"done":true,"usage":{"inputTokens":1,"outputTokens":2}}'].map((l) => l + String.fromCharCode(10)).join('');
      return new Response(ndjson, { status: 200 });
    }) as unknown as typeof fetch;
    const deltas: string[] = [];
    const p = streamWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation: 'chat', tenantId: TENANT }, onDelta: (d) => deltas.push(d) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe('hello world');
    expect(log).toEqual(['groq', 'groq', 'groq', 'gemini']);
    expect(deltas.join('')).toBe('hello world');
  });
});

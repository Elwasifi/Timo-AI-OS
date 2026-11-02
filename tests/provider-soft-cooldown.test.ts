// M7-13c-1: soft cooldown for "unavailable right now" failures (503 / timeout /
// empty completion), bounded same-model retries, and per-attempt timers capped to
// the remaining deadline. Everything is stubbed (fetch, health, settings) — no
// network, no DB — and runs on fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelHealth } from '@/lib/ai/router/types';
import { recordHealth } from '@/lib/ai/router/healthTracker';

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
const tenantCfg = vi.hoisted(() => ({ providers: ['groq', 'gemini'] as string[] }));
vi.mock('@/lib/settings/tenantConfiguredProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/tenantConfiguredProviders')>();
  return {
    ...actual,
    loadTenantProviderConfig: async () => tenantCfg.providers.map((provider) => ({ provider: provider as 'groq', model: null })),
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
  AIProviderError,
  chatWithFallback,
  streamWithFallback,
  isCircuitOpen,
  isSoftCooledDown,
  recordSoftFailure,
  resetProviderCircuits,
  requestTimeoutFor,
  isInteractiveCall,
  tripCircuitIfHardFailure,
  SOFT_COOLDOWN_MS,
  CIRCUIT_COOLDOWN_MS,
  OPERATION_LIMITS,
  __setRetryAttemptsForTesting,
  __getRetryPolicyForTesting,
} from '@/lib/ai/ai-provider';

const TENANT = 'soft-tenant';
const OTHER = 'other-tenant';
const routed = [
  { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
  { provider: 'gemini' as const, model: 'gemini-3.1-flash-lite-preview' },
];
const GROQ = routed[0].model;
const GEMINI = routed[1].model;

const realFetch = globalThis.fetch;
type Call = { provider: string; at: number };

const okBody = (provider: string, model: string, content = 'from ' + provider) =>
  new Response(JSON.stringify({ content, usage: { inputTokens: 1, outputTokens: 1 }, model }), { status: 200 });
const errBody = (status: number) => new Response(JSON.stringify({ error: 'down (' + status + ')' }), { status });

/** A request that settles after `ms` (or aborts when its signal fires). */
const after = (ms: number, make: () => Response, signal?: AbortSignal | null) =>
  new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(make()), ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
  });
const stall = (signal?: AbortSignal | null) =>
  new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

/** rules: provider -> handler; unlisted providers answer OK immediately. Records every request. */
function stubFetch(rules: Record<string, (signal?: AbortSignal | null) => Promise<Response>>, calls: Call[]) {
  globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ provider: body.provider, at: Date.now() });
    return rules[body.provider] ? rules[body.provider](init?.signal) : Promise.resolve(okBody(body.provider, body.model));
  }) as unknown as typeof fetch;
}

const chat = (operation = 'chat', tenantId: string | null = TENANT) =>
  chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: routed, usageContext: { operation, tenantId } });

beforeEach(() => {
  vi.useFakeTimers();
  resetProviderCircuits();
  healthRows.clear();
  vi.mocked(recordHealth).mockClear();
  tenantCfg.providers = ['groq', 'gemini'];
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
  __setRetryAttemptsForTesting({ interactiveAttempts: 2, longAttempts: 3, rateLimitAttempts: 3 });   // the shipped defaults; only the injection test changes them
});

describe('shipped retry policy', () => {
  it('interactive calls get 2 attempts per model, mission-class 3, and a provider 429 keeps its 3', () => {
    expect(__getRetryPolicyForTesting()).toEqual({ interactiveAttempts: 2, longAttempts: 3, rateLimitAttempts: 3 });
  });
});

describe('empty completion', () => {
  it('moves to the next candidate with NO same-model retry', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(okBody('groq', GROQ, '   ')) }, calls);
    const r = await chat();
    expect(r.content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);
  });

  it('two empties within the window put the model into a soft cooldown; one does not', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(okBody('groq', GROQ, '')) }, calls);
    await chat();
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    await chat();
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
    await chat(); // third call: groq is deferred behind gemini, so it is not even asked
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini', 'groq', 'gemini', 'gemini']);
  });

  it('empties further apart than the window do not accumulate', () => {
    const e = new AIProviderError('empty', 200, 'groq', 'empty_response');
    const t0 = Date.now();
    expect(recordSoftFailure(TENANT, 'groq', GROQ, e, t0)).toBe(false);
    expect(recordSoftFailure(TENANT, 'groq', GROQ, e, t0 + SOFT_COOLDOWN_MS + 1)).toBe(false);
    expect(recordSoftFailure(TENANT, 'groq', GROQ, e, t0 + SOFT_COOLDOWN_MS + 2)).toBe(true);
  });
});

describe('503 — bounded same-model retries and a deadline that always holds', () => {
  it('interactive: exactly 2 attempts at the model, then the next candidate, well inside the deadline', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(503)) }, calls);
    const t0 = Date.now();
    let settledAt = 0;
    const p = chat();
    void p.then(() => { settledAt = Date.now(); });
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await p).content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'groq', 'gemini']);
    expect(settledAt - t0).toBe(1_000); // one 1s backoff, not 1s + 2s
  });

  it('mission-class (mission_task) keeps 3 attempts', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(503)) }, calls);
    const p = chat('mission_task');
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await p).content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'groq', 'groq', 'gemini']);
  });

  it('retry counts are injectable', async () => {
    __setRetryAttemptsForTesting({ interactiveAttempts: 1 });
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(503)) }, calls);
    const r = await chat();
    expect(r.content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);
  });

  it('a counted 5xx (after the retries) puts the model into a soft cooldown; the next call goes to the healthy model first', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(503)) }, calls);
    const p = chat();
    await vi.advanceTimersByTimeAsync(2_000);
    await p;
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
    calls.length = 0;
    await chat();
    expect(calls.map((c) => c.provider)).toEqual(['gemini']);
  });

  it('tool_planning: a slow-503 provider can never outlast the 20s budget — every attempt is capped to what is left', async () => {
    const calls: Call[] = [];
    stubFetch({
      groq: (s) => after(10_000, () => errBody(503), s),   // answers 503 after 10s
      gemini: (s) => stall(s),
    }, calls);
    const t0 = Date.now();
    const p = chat('tool_planning');
    const assertion = expect(p).rejects.toMatchObject({ code: 'deadline' });
    await vi.advanceTimersByTimeAsync(21_000);
    await assertion;
    // attempt 1 at 0s (answers 503 at 10s); the 1s backoff fits, attempt 2 starts at 11s with only 9s left
    // and is aborted at 20s — it can no more consume the whole budget than attempt 1 could.
    expect(calls.map((c) => Math.round((c.at - t0) / 1000))).toEqual([0, 11]);
    expect(OPERATION_LIMITS.tool_planning).toEqual({ perAttemptMs: 12_000, deadlineMs: 20_000 });
  });

  it('a 503 that arrives with too little budget left for the backoff plus a useful attempt is not retried', async () => {
    const calls: Call[] = [];
    // groq stalls for its full 20s; gemini answers 503 after 9s, i.e. at t=29s of the 30s budget -> 1s left, the 1s backoff would leave 0
    stubFetch({ groq: (s) => stall(s), gemini: (s) => after(9_000, () => errBody(503), s) }, calls);
    const p = chat();
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);   // no second gemini attempt
  });

  it('whatever the timing, no third same-model attempt and nothing starts with less than a useful attempt left', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: (s) => after(11_900, () => errBody(503), s), gemini: (s) => stall(s) }, calls);
    // tool_planning (12s per attempt, 20s budget): groq answers 503 at 11.9s; the retry and gemini then compete for the last 8s.
    const p = chat('tool_planning');
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(21_000);
    await assertion;
    const providers = calls.map((c) => c.provider);
    expect(providers.filter((x) => x === 'groq').length).toBeLessThanOrEqual(2);   // never a third same-model attempt
    expect(calls.every((c) => c.at - calls[0].at <= 20_000 - 1_500)).toBe(true);    // nothing STARTS with less than a useful attempt left
  });
});

describe('timeout -> soft cooldown', () => {
  it('is set after a timeout, skips the model in-window, and retries it once the cooldown expires', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: (s) => stall(s) }, calls);

    let p = chat();
    await vi.advanceTimersByTimeAsync(20_100);
    expect((await p).content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);   // timeouts are not retried on the same model
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);

    calls.length = 0;
    expect((await chat()).content).toBe('from gemini');                  // in-window: groq is behind gemini and never asked
    expect(calls.map((c) => c.provider)).toEqual(['gemini']);

    await vi.advanceTimersByTimeAsync(SOFT_COOLDOWN_MS + 1_000);
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    calls.length = 0;
    p = chat();
    await vi.advanceTimersByTimeAsync(20_100);
    await p;
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);   // tried first again
  });
});

describe('never skips the last remaining candidate', () => {
  it('a single cooled candidate is still attempted', async () => {
    tenantCfg.providers = ['groq'];
    const calls: Call[] = [];
    stubFetch({}, calls);
    recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('t', 408, 'groq', 'timeout'));
    const r = await chatWithFallback([{ role: 'user', content: 'hi' }], { candidates: [routed[0]], usageContext: { operation: 'chat', tenantId: TENANT } });
    expect(r.content).toBe('from groq');
    expect(calls.map((c) => c.provider)).toEqual(['groq']);
  });

  it('a cooled model is deferred, not dropped: when the healthy one fails it is still tried afterwards', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: () => Promise.resolve(errBody(503)) }, calls);
    recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('t', 408, 'groq', 'timeout'));
    const p = chat();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await p).content).toBe('from groq');
    expect(calls.map((c) => c.provider)).toEqual(['gemini', 'gemini', 'groq']);
  });

  it('when every candidate is cooled the order is unchanged', async () => {
    const calls: Call[] = [];
    stubFetch({}, calls);
    for (const r of routed) recordSoftFailure(TENANT, r.provider, r.model, new AIProviderError('t', 408, r.provider, 'timeout'));
    expect((await chat()).content).toBe('from groq');
    expect(calls.map((c) => c.provider)).toEqual(['groq']);
  });

  it('a lastResort chain bypasses the soft cooldown (like the hard circuit)', async () => {
    // both pairs have never worked -> prioritizePairs returns them as lastResort, router order kept
    healthRows.set(`groq::${GROQ}`, { provider: 'groq', modelId: GROQ, successCount: 0, failureCount: 3, consecutiveFailures: 0, avgLatencyMs: null, lastSuccessAt: null, lastFailureAt: null, lastStatusCode: null });
    healthRows.set(`gemini::${GEMINI}`, { provider: 'gemini', modelId: GEMINI, successCount: 0, failureCount: 3, consecutiveFailures: 0, avgLatencyMs: null, lastSuccessAt: null, lastFailureAt: null, lastStatusCode: null });
    const calls: Call[] = [];
    stubFetch({}, calls);
    recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('t', 408, 'groq', 'timeout'));
    expect((await chat()).content).toBe('from groq');   // without the bypass groq would sit behind gemini
    expect(calls.map((c) => c.provider)).toEqual(['groq']);
  });
});

describe('what is NOT counted', () => {
  it.each([
    ['400 bad request', 400],
    ['422 unprocessable', 422],
    ['429 rate limit', 429],
    ['401 key rejected (hard path)', 401],
    ['404 model gone (hard path)', 404],
    ['network error', 0],
  ])('%s', (_label, status) => {
    expect(recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('x', status as number, 'groq'))).toBe(false);
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
  });

  it('our own deadline error and a content/safety refusal do not count', () => {
    expect(recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('too slow', 408, 'groq', 'deadline'))).toBe(false);
    expect(recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('blocked by safety filter', 400, 'groq'))).toBe(false);
  });

  it.each([500, 502, 503, 504])('%i IS counted', (status) => {
    expect(recordSoftFailure(TENANT, 'groq', GROQ, new AIProviderError('x', status, 'groq'))).toBe(true);
  });
});

describe('hard circuit is untouched and always wins', () => {
  it('a 404 still trips the 30-minute circuit and does NOT set a soft cooldown', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(404)) }, calls);
    await chat();
    expect(isCircuitOpen(TENANT, 'groq', GROQ)).toBe(true);
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    expect(CIRCUIT_COOLDOWN_MS).toBe(30 * 60 * 1000);
    expect(tripCircuitIfHardFailure(TENANT, 'gemini', GEMINI, 503)).toBe(false);   // soft statuses never trip the hard circuit
  });

  it('a soft-cooled model that is ALSO circuit-open is not revived by the soft logic', async () => {
    const calls: Call[] = [];
    stubFetch({}, calls);
    tripCircuitIfHardFailure(TENANT, 'groq', GROQ, 404);
    recordSoftFailure(TENANT, 'gemini', GEMINI, new AIProviderError('t', 408, 'gemini', 'timeout'));
    expect((await chat()).content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['gemini']);
  });
});

describe('reset and tenant isolation', () => {
  const trip = (tenant: string | null, provider: 'groq' | 'gemini', model: string) =>
    recordSoftFailure(tenant, provider, model, new AIProviderError('t', 408, provider, 'timeout'));

  it('saving a key (resetProviderCircuits) clears the soft cooldown and pending empty strikes for that scope only', () => {
    trip(TENANT, 'groq', GROQ);
    trip(TENANT, 'gemini', GEMINI);
    recordSoftFailure(TENANT, 'groq', 'other-model', new AIProviderError('e', 200, 'groq', 'empty_response'));
    resetProviderCircuits(TENANT, 'groq');
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    expect(isSoftCooledDown(TENANT, 'gemini', GEMINI)).toBe(true);
    // the cleared strike really is gone: one more empty is again a FIRST strike
    expect(recordSoftFailure(TENANT, 'groq', 'other-model', new AIProviderError('e', 200, 'groq', 'empty_response'))).toBe(false);
    resetProviderCircuits(TENANT);
    expect(isSoftCooledDown(TENANT, 'gemini', GEMINI)).toBe(false);
  });

  it("tenant A's cooldown does not affect tenant B or the internal bucket", () => {
    trip(TENANT, 'groq', GROQ);
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
    expect(isSoftCooledDown(OTHER, 'groq', GROQ)).toBe(false);
    expect(isSoftCooledDown(null, 'groq', GROQ)).toBe(false);
    resetProviderCircuits(OTHER);
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
  });

  it('internal tenant (no tenantId): with no soft entries the chain behaves exactly as before — router order, one request', async () => {
    const calls: Call[] = [];
    stubFetch({}, calls);
    expect((await chat('chat', null)).content).toBe('from groq');
    expect(calls.map((c) => c.provider)).toEqual(['groq']);
  });
});

describe('fast_acknowledgment budget', () => {
  it('has a 4.5s per-attempt limit, a 5s deadline, and counts as interactive', () => {
    expect(requestTimeoutFor({ usageContext: { operation: 'fast_acknowledgment' } })).toBe(4_500);
    expect(isInteractiveCall({ usageContext: { operation: 'fast_acknowledgment' } })).toBe(true);
    expect(OPERATION_LIMITS.fast_acknowledgment).toMatchObject({ perAttemptMs: 4_500, deadlineMs: 5_000, noRetry: true });
  });

  it('never retries the same model (503 -> straight to the next candidate)', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(503)) }, calls);
    const r = await chat('fast_acknowledgment');
    expect(r.content).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);
  });

  it('with every provider stalling it gives up at ~5s with a deadline error, aborting the request', async () => {
    const calls: Call[] = [];
    let aborted = 0;
    globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => {
      calls.push({ provider: JSON.parse(String(init?.body)).provider, at: Date.now() });
      init?.signal?.addEventListener('abort', () => { aborted++; });
      return stall(init?.signal);
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    let settledAt = 0;
    const p = chat('fast_acknowledgment');
    const assertion = expect(p).rejects.toThrow();
    void p.catch(() => { settledAt = Date.now(); });
    await vi.advanceTimersByTimeAsync(5_100);
    await assertion;
    expect(settledAt - t0).toBeLessThanOrEqual(5_000);
    expect(aborted).toBeGreaterThanOrEqual(1);   // the in-flight request was aborted by its own timer, not left running
  });
});

// ---- a timeout caused by OUR short / shortened budget must not poison the model ----
//
// fast_acknowledgment has a deliberate 4.5s per-attempt limit while live Groq
// first-token latency is 3.4-4.8s, and any attempt's timer can be shortened to
// the time left in the overall deadline. Neither says anything about whether the
// model is up, so neither may soft-cool it (for ALL calls, normal chat included)
// or add a failed sample to its health.

const failedHealth = (provider: string) =>
  vi.mocked(recordHealth).mock.calls.map((c) => c[0]).filter((h) => h.provider === provider && h.success === false);

describe('budget-limited timeouts do not count against the model', () => {
  it('(1) fast_acknowledgment timing out at 4.5s: no soft cooldown, no failed health sample, and normal chat right after still tries groq first', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: (s) => stall(s) }, calls);
    const p = chat('fast_acknowledgment');
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_100);
    await assertion;
    expect(calls.map((c) => c.provider)).toEqual(['groq']);               // timed out at 4.5s; 0.5s left is too little for gemini
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    expect(failedHealth('groq')).toEqual([]);

    const next: Call[] = [];
    stubFetch({}, next);
    expect((await chat()).content).toBe('from groq');                     // a normal chat call is not steered away from groq
    expect(next.map((c) => c.provider)).toEqual(['groq']);
  });

  it('(1b) the streaming path behaves the same', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: (s) => stall(s) }, calls);
    const p = streamWithFallback([{ role: 'user', content: 'hi' }], {
      candidates: routed, usageContext: { operation: 'fast_acknowledgment', tenantId: TENANT }, onDelta: () => {},
    });
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_100);
    await assertion;
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    expect(failedHealth('groq')).toEqual([]);
  });

  it('(2) a timeout on an attempt whose timer was capped below the full limit by the remaining budget does not cool the model', async () => {
    const calls: Call[] = [];
    // groq fails with a plain 400 after 15s (not a counted failure); gemini then gets only 15s of the 30s budget (< its full 20s) and stalls
    stubFetch({ groq: (s) => after(15_000, () => errBody(400), s), gemini: (s) => stall(s) }, calls);
    const p = chat();
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(calls.map((c) => c.provider)).toEqual(['groq', 'gemini']);
    expect(isSoftCooledDown(TENANT, 'gemini', GEMINI)).toBe(false);
    expect(failedHealth('gemini')).toEqual([]);
    expect(failedHealth('groq').length).toBe(1);                         // the 400 is a real, unrelated failure and is still recorded
  });

  it('(2b) the same holds for a RETRY attempt whose timer was shortened (503, then a stall that hits the deadline)', async () => {
    const calls: Call[] = [];
    let n = 0;
    stubFetch({ groq: (s) => (++n === 1 ? after(10_000, () => errBody(503), s) : stall(s)) }, calls);
    const p = chat();
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    // attempt 2 started at 11s with 19s left (< the full 20s) and was cut off at the deadline
    expect(calls.map((c) => c.provider).slice(0, 2)).toEqual(['groq', 'groq']);
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(false);
    expect(failedHealth('groq')).toEqual([]);
  });

  it('(3) a FULL-budget timeout on a normal interactive chat call still cools the model and is still recorded as a failure', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: (s) => stall(s) }, calls);
    const p = chat();
    await vi.advanceTimersByTimeAsync(20_100);
    await p;
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
    expect(failedHealth('groq')).toEqual([expect.objectContaining({ modelId: GROQ, statusCode: 408 })]);
  });

  it('(3b) tool_planning: a timeout at its full 12s still counts; the fallback model that only had the remaining 8s does not', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: (s) => stall(s), gemini: (s) => stall(s) }, calls);
    const p = chat('tool_planning');
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(21_000);
    await assertion;
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
    expect(isSoftCooledDown(TENANT, 'gemini', GEMINI)).toBe(false);
  });

  it('(4) a 503 from fast_acknowledgment still counts (soft cooldown and a failed health sample)', async () => {
    const calls: Call[] = [];
    stubFetch({ groq: () => Promise.resolve(errBody(503)) }, calls);
    expect((await chat('fast_acknowledgment')).content).toBe('from gemini');
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
    expect(failedHealth('groq')).toEqual([expect.objectContaining({ statusCode: 503 })]);
  });

  it('(4b) an empty completion from fast_acknowledgment still counts as a strike', async () => {
    stubFetch({ groq: () => Promise.resolve(okBody('groq', GROQ, '')) }, []);
    await chat('fast_acknowledgment');
    expect(failedHealth('groq')).toEqual([expect.objectContaining({ statusCode: 200 })]);
    await chat('fast_acknowledgment');
    expect(isSoftCooledDown(TENANT, 'groq', GROQ)).toBe(true);
  });

  it('flags: only fast_acknowledgment is a short-budget operation', () => {
    expect(OPERATION_LIMITS.fast_acknowledgment.shortBudget).toBe(true);
    expect(OPERATION_LIMITS.tool_planning.shortBudget).toBeUndefined();
  });
});

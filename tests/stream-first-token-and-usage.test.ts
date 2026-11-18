// M7-13c-2c-b (B1 + B5) — streamed chat replies.
//
// B1  FIRST-TOKEN TIMEOUT. Live: a greeting waited ~10 s for Gemini's first token while Groq answers in ~1.2 s. A streamed INTERACTIVE
//     reply now gives each candidate FIRST_TOKEN_TIMEOUT_MS (6 s) to produce a visible token IF another candidate is queued behind it;
//     if not, the request is aborted and the next candidate runs. It never applies to the last/only candidate (a slow-but-only provider
//     still answers), never opens a circuit and never records a failed health sample; the slow model is only deferred for
//     FIRST_TOKEN_COOLDOWN_MS (a soft cooldown). The 20 s idle limit and the 30 s overall deadline are unchanged.
// B5  recordUsage() of a streamed reply no longer blocks the reply: fire-and-forget, own catch, still recorded, flushable.
//
// Everything is stubbed (fetch, health, settings, usage ledger) and runs on fake timers: no network, no DB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelHealth } from '@/lib/ai/router/types';
import { recordHealth } from '@/lib/ai/router/healthTracker';

const h = vi.hoisted(() => ({ recordUsage: vi.fn(async (_i: unknown) => {}), tenantProviders: ['groq', 'gemini'] as string[] }));

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
vi.mock('@/lib/ai/usageLedger', () => ({ recordUsage: h.recordUsage }));
vi.mock('@/lib/governance/entitlements', () => ({ checkBudget: vi.fn(async () => ({ withinBudget: true, spendUsd: 0, limitUsd: null })) }));
vi.mock('@/lib/settings/tenantConfiguredProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/tenantConfiguredProviders')>();
  return { ...actual, loadTenantProviderConfig: async () => h.tenantProviders.map((provider) => ({ provider: provider as 'groq', model: null })) };
});
vi.mock('@/lib/settings/settings-service', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/settings-service')>();
  return { ...actual, loadSettings: async () => ({ ...actual.DEFAULT_SETTINGS, active_provider: 'groq', groq_api_key: 'k', gemini_api_key: 'k' }) };
});

import {
  streamWithFallback,
  flushPendingUsageRecords,
  isCircuitOpen,
  isSoftCooledDown,
  resetProviderCircuits,
  FIRST_TOKEN_TIMEOUT_MS,
  FIRST_TOKEN_COOLDOWN_MS,
  INTERACTIVE_DEADLINE_MS,
} from '@/lib/ai/ai-provider';

const TENANT = 'ft-tenant';
const GEMINI = { provider: 'gemini' as const, model: 'gemini-flash-lite-latest' };
const GROQ = { provider: 'groq' as const, model: 'openai/gpt-oss-120b' };

const realFetch = globalThis.fetch;
type Call = { provider: string; at: number; aborted: boolean };

const line = (o: unknown) => JSON.stringify(o);

/** A 200 streaming response that emits `events` (ms -> NDJSON line) and closes; aborting its signal errors the stream. */
function streamResponse(events: Array<[number, string]>, signal?: AbortSignal | null, onAbort?: () => void): Response {
  const enc = new TextEncoder();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [ms, text] of events) timers.push(setTimeout(() => { try { controller.enqueue(enc.encode(text + '\n')); } catch { /* closed */ } }, ms));
      timers.push(setTimeout(() => { try { controller.close(); } catch { /* closed */ } }, Math.max(...events.map((e) => e[0])) + 1));
      signal?.addEventListener('abort', () => {
        timers.forEach(clearTimeout);
        onAbort?.();
        try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ }
      });
    },
  });
  return new Response(body, { status: 200 });
}

/** A reply whose first visible token arrives after `firstMs`, then a final usage line. */
const reply = (text: string, firstMs: number) => (signal?: AbortSignal | null, onAbort?: () => void) =>
  Promise.resolve(streamResponse([[firstMs, line({ delta: text })], [firstMs + 50, line({ done: true, usage: { inputTokens: 10, outputTokens: 5 } })]], signal, onAbort));

function stubFetch(rules: Record<string, ReturnType<typeof reply>>, calls: Call[]) {
  globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const call: Call = { provider: body.provider, at: Date.now(), aborted: false };
    calls.push(call);
    return (rules[body.provider] ?? reply('from ' + body.provider, 100))(init?.signal, () => { call.aborted = true; });
  }) as unknown as typeof fetch;
}

const stream = (candidates = [GEMINI, GROQ], extra: Record<string, unknown> = {}, operation = 'chat') => {
  const deltas: string[] = [];
  const p = streamWithFallback([{ role: 'user', content: 'hi' }], {
    candidates, usageContext: { operation, tenantId: TENANT }, onDelta: (_d: string, full: string) => { deltas.push(full); }, ...extra,
  } as never);
  return { p, deltas };
};

beforeEach(() => {
  vi.useFakeTimers();
  resetProviderCircuits();
  healthRows.clear();
  vi.mocked(recordHealth).mockClear();
  h.recordUsage.mockReset();
  h.tenantProviders = ['groq', 'gemini'];
  h.recordUsage.mockImplementation(async () => {});
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe('B1 - first-token timeout', () => {
  it('the budget is a named, exported ~6 s constant, well inside the 20 s idle limit and the 30 s deadline', () => {
    expect(FIRST_TOKEN_TIMEOUT_MS).toBe(6000);
    expect(FIRST_TOKEN_TIMEOUT_MS).toBeLessThan(INTERACTIVE_DEADLINE_MS);
  });

  it('a slow first token (10 s) with another candidate queued: the first request is ABORTED at 6 s and the next candidate answers', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 10_000), groq: reply('from groq', 200) }, calls);
    const t0 = Date.now();
    const { p, deltas } = stream();
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS + 500);
    const text = await p;
    expect(text).toBe('from groq');
    expect(deltas[deltas.length - 1]).toBe('from groq');
    expect(calls.map((c) => c.provider)).toEqual(['gemini', 'groq']);
    expect(calls[0].aborted).toBe(true);
    expect(calls[1].at - t0).toBeGreaterThanOrEqual(FIRST_TOKEN_TIMEOUT_MS);
    expect(calls[1].at - t0).toBeLessThan(FIRST_TOKEN_TIMEOUT_MS + 100);
  });

  it('the abort does NOT open a circuit and does NOT record a failed health sample for the slow model; it is only softly deferred', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 10_000), groq: reply('from groq', 200) }, calls);
    const { p } = stream();
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS + 500);
    await p;
    expect(isCircuitOpen(TENANT, GEMINI.provider, GEMINI.model)).toBe(false);
    const failures = vi.mocked(recordHealth).mock.calls.map((c) => c[0]).filter((s) => s.success === false);
    expect(failures).toEqual([]);                                  // no failed sample for gemini (or anyone)
    expect(isSoftCooledDown(TENANT, GEMINI.provider, GEMINI.model)).toBe(true);
    expect(isSoftCooledDown(TENANT, GEMINI.provider, GEMINI.model, Date.now() + FIRST_TOKEN_COOLDOWN_MS + 1)).toBe(false);   // short, self-expiring
    expect(FIRST_TOKEN_COOLDOWN_MS).toBeLessThanOrEqual(60_000);
  });

  it('the NEXT turn goes to the healthy model first (the slow one is deferred), so the user does not wait 6 s again', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 10_000), groq: reply('from groq', 200) }, calls);
    const first = stream();
    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS + 500);
    await first.p;
    calls.length = 0;
    const second = stream();
    await vi.advanceTimersByTimeAsync(500);
    expect(await second.p).toBe('from groq');
    expect(calls.map((c) => c.provider)).toEqual(['groq']);
  });

  it('a SOLE candidate (the tenant has only gemini configured) is never aborted for being slow: a 10 s first token still answers', async () => {
    h.tenantProviders = ['gemini'];   // resolveOrderedPairs appends every configured tenant provider, so "sole" means one configured provider
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 10_000) }, calls);
    const { p } = stream([GEMINI]);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await p).toBe('from gemini');
    expect(calls).toHaveLength(1);
    expect(calls[0].aborted).toBe(false);
  });

  it('when EVERY candidate is slow the call still answers: each is aborted once at 6 s, then the first is retried WITHOUT the budget', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 9_000), groq: reply('from groq', 9_000) }, calls);
    const { p } = stream();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await p).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['gemini', 'groq', 'gemini']);
    expect(calls.map((c) => c.aborted)).toEqual([true, true, false]);
  });

  it('a fast first token (1 s) is never aborted: one request, no cooldown', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 1_000) }, calls);
    const { p } = stream();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toBe('from gemini');
    expect(calls).toHaveLength(1);
    expect(isSoftCooledDown(TENANT, GEMINI.provider, GEMINI.model)).toBe(false);
  });

  it('a token that arrives just inside the budget (5.9 s) is not aborted', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 5_900) }, calls);
    const { p } = stream();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await p).toBe('from gemini');
    expect(calls).toHaveLength(1);
  });

  it('non-interactive (mission) streams are not subject to it, and firstTokenTimeoutMs: 0 switches it off', async () => {
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 10_000), groq: reply('from groq', 200) }, calls);
    const mission = stream([GEMINI, GROQ], {}, 'mission_task');
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await mission.p).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['gemini']);

    calls.length = 0;
    resetProviderCircuits();
    const off = stream([GEMINI, GROQ], { firstTokenTimeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await off.p).toBe('from gemini');
    expect(calls.map((c) => c.provider)).toEqual(['gemini']);
  });

  it('the 20 s idle limit is unchanged: a stream that sends a token and then goes silent is still cut by it (not by the first-token budget)', async () => {
    const calls: Call[] = [];
    stubFetch({
      gemini: (signal, onAbort) => Promise.resolve(streamResponse([[500, line({ delta: 'partial' })], [60_000, line({ delta: 'late' })]], signal, onAbort)),
      groq: reply('from groq', 200),
    }, calls);
    const { p } = stream();
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await p.catch(() => {});
    expect(calls[0].provider).toBe('gemini');
    expect(calls[0].aborted).toBe(true);
    expect(isSoftCooledDown(TENANT, GEMINI.provider, GEMINI.model)).toBe(true);   // an idle timeout is a normal counted timeout (existing behaviour)
  });
});

describe('B5 - usage recording does not block the streamed reply', () => {
  it('the reply resolves while the ledger insert is still pending; the record is still made and can be flushed', async () => {
    let release!: () => void;
    h.recordUsage.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 100) }, calls);
    const { p } = stream([GEMINI]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe('from gemini');                          // resolved although recordUsage has NOT settled
    expect(h.recordUsage).toHaveBeenCalledTimes(1);
    const input = h.recordUsage.mock.calls[0][0] as { provider: string; model: string; inputTokens: number; outputTokens: number; context: { operation: string; tenantId: string } };
    expect(input).toMatchObject({ provider: 'gemini', model: GEMINI.model, inputTokens: 10, outputTokens: 5 });
    expect(input.context).toMatchObject({ operation: 'chat', tenantId: TENANT });

    let flushed = false;
    const flush = flushPendingUsageRecords().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);                                  // still waiting on the pending insert
    release();
    await flush;
    expect(flushed).toBe(true);
  });

  it('a failing ledger insert is swallowed: the reply is delivered, no unhandled rejection, flush does not reject', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    h.recordUsage.mockImplementation(async () => { throw new Error('ledger down'); });
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 100) }, calls);
    const { p } = stream([GEMINI]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe('from gemini');
    await expect(flushPendingUsageRecords()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    expect(h.recordUsage).toHaveBeenCalledTimes(1);
  });

  it('a synchronous throw inside recordUsage is also swallowed', async () => {
    h.recordUsage.mockImplementation((() => { throw new Error('sync boom'); }) as never);
    const calls: Call[] = [];
    stubFetch({ gemini: reply('from gemini', 100) }, calls);
    const { p } = stream([GEMINI]);
    await vi.advanceTimersByTimeAsync(500);
    // The throw happens while building the promise; the reply must still be returned.
    await expect(p).resolves.toBe('from gemini');
  });
});

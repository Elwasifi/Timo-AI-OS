// M7-13c-1b: reasoning-style models (openai/gpt-oss-*) burn max_tokens on hidden
// reasoning, so tiny background calls (memory yes/no 128, importance 10, summary
// 150, acknowledgment 256 ...) came back EMPTY, were counted as failures, and the
// second one soft-cooled the model that serves foreground chat. Central guard:
// what is actually SENT is raised to REASONING_MIN_MAX_TOKENS for such models only.
// Mocked providers (fetch stub), no network, no DB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelHealth } from '@/lib/ai/router/types';
import { recordUsage } from '@/lib/ai/usageLedger';

const healthRows = new Map<string, ModelHealth>();
vi.mock('@/lib/ai/router/healthTracker', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/router/healthTracker')>();
  return {
    ...actual,
    getAllHealth: async () => healthRows,
    getHealth: async () => null,
    recordHealth: vi.fn(),
  };
});
vi.mock('@/lib/ai/usageLedger', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/governance/entitlements', () => ({ checkBudget: vi.fn(async () => ({ withinBudget: true, spendUsd: 0, limitUsd: null })) }));
vi.mock('@/lib/settings/tenantConfiguredProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/tenantConfiguredProviders')>();
  return {
    ...actual,
    loadTenantProviderConfig: async () => [
      { provider: 'groq' as const, model: null },
      { provider: 'gemini' as const, model: null },
    ],
  };
});
vi.mock('@/lib/settings/settings-service', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/settings-service')>();
  return { ...actual, loadSettings: async () => ({ ...actual.DEFAULT_SETTINGS, active_provider: 'groq', groq_api_key: 'k', gemini_api_key: 'k' }) };
});

import {
  chatWithFallback,
  streamWithFallback,
  resetProviderCircuits,
  isReasoningStyleModel,
  effectiveMaxTokens,
  REASONING_MIN_MAX_TOKENS,
  isSoftCooledDown,
} from '@/lib/ai/ai-provider';

const TENANT = 'floor-tenant';
const GPT_OSS = { provider: 'groq' as const, model: 'openai/gpt-oss-120b' };
const GEMINI = { provider: 'gemini' as const, model: 'gemini-3.1-flash-lite-preview' };
const realFetch = globalThis.fetch;

type Sent = { provider: string; model: string; maxTokens: number };

/** Records the max_tokens each request actually carried; answers like the edge function (chat JSON or ndjson stream). */
function stubFetch(sent: Sent[], opts: { failProviders?: Set<string>; outputTokens?: number } = {}) {
  globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ provider: body.provider, model: body.model, maxTokens: body.maxTokens });
    if (opts.failProviders?.has(body.provider)) return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    const usage = { inputTokens: 3, outputTokens: opts.outputTokens ?? 5 };
    if (body.stream) {
      const nl = String.fromCharCode(10);
      const ndjson = [JSON.stringify({ delta: 'ok ' }), JSON.stringify({ delta: body.provider }), JSON.stringify({ done: true, usage })].map((l) => l + nl).join('');
      return new Response(ndjson, { status: 200 });
    }
    return new Response(JSON.stringify({ content: 'ok ' + body.provider, usage, model: body.model }), { status: 200 });
  }) as unknown as typeof fetch;
}

const chat = (candidates: Array<{ provider: 'groq' | 'gemini'; model: string }>, maxTokens: number | undefined, operation = 'memory_should_remember') =>
  chatWithFallback([{ role: 'user', content: 'x' }], { candidates, maxTokens, usageContext: { operation, tenantId: TENANT } });
const stream = (candidates: Array<{ provider: 'groq' | 'gemini'; model: string }>, maxTokens: number | undefined) =>
  streamWithFallback([{ role: 'user', content: 'x' }], { candidates, maxTokens, usageContext: { operation: 'chat', tenantId: TENANT }, onDelta: () => {} });

beforeEach(() => { resetProviderCircuits(); healthRows.clear(); vi.mocked(recordUsage).mockClear(); });
afterEach(() => { globalThis.fetch = realFetch; });

describe('pure helpers', () => {
  it('the floor is 1024', () => { expect(REASONING_MIN_MAX_TOKENS).toBe(1024); });

  it('isReasoningStyleModel matches gpt-oss ids on any provider, and nothing else we route to today', () => {
    for (const id of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'openai/gpt-oss-20b:free', 'GPT-OSS-120B']) expect(isReasoningStyleModel(id)).toBe(true);
    for (const id of ['gemini-3.1-flash-lite-preview', 'llama-3.3-70b-versatile', 'meta/llama-3.1-405b-instruct', 'openrouter/auto', '']) expect(isReasoningStyleModel(id)).toBe(false);
  });

  it('effectiveMaxTokens raises small values for reasoning models, never lowers, and leaves other models alone', () => {
    expect(effectiveMaxTokens('openai/gpt-oss-120b', 128)).toBe(1024);
    expect(effectiveMaxTokens('openai/gpt-oss-120b', 10)).toBe(1024);
    expect(effectiveMaxTokens('openai/gpt-oss-120b', 512)).toBe(1024);
    expect(effectiveMaxTokens('openai/gpt-oss-120b', 1024)).toBe(1024);
    expect(effectiveMaxTokens('openai/gpt-oss-120b', 2000)).toBe(2000);
    expect(effectiveMaxTokens('openai/gpt-oss-120b', 8000)).toBe(8000);
    expect(effectiveMaxTokens('openai/gpt-oss-120b', undefined)).toBe(2048);     // the provider default, already above the floor
    expect(effectiveMaxTokens('gemini-3.1-flash-lite-preview', 128)).toBe(128);
    expect(effectiveMaxTokens('gemini-3.1-flash-lite-preview', undefined)).toBeUndefined();
  });
});

describe('chatWithFallback — what is actually sent', () => {
  it('(1) maxTokens 128 to groq/gpt-oss-120b is sent as >= 1024', async () => {
    const sent: Sent[] = [];
    stubFetch(sent);
    await chat([GPT_OSS], 128);
    expect(sent).toEqual([{ provider: 'groq', model: 'openai/gpt-oss-120b', maxTokens: 1024 }]);
  });

  it('(2) the same call routed to a non-reasoning model (gemini) keeps 128', async () => {
    const sent: Sent[] = [];
    stubFetch(sent);
    await chat([GEMINI], 128);
    expect(sent).toEqual([{ provider: 'gemini', model: 'gemini-3.1-flash-lite-preview', maxTokens: 128 }]);
  });

  it('(3) a caller asking for 2000 (or more) keeps it — the floor never lowers', async () => {
    const sent: Sent[] = [];
    stubFetch(sent);
    await chat([GPT_OSS], 2000);
    await chat([GPT_OSS], 4096);
    expect(sent.map((s) => s.maxTokens)).toEqual([2000, 4096]);
  });

  it('is applied PER CANDIDATE: when the reasoning model fails, the fallback model gets the caller value, not the floor', async () => {
    const sent: Sent[] = [];
    stubFetch(sent, { failProviders: new Set(['groq']) });
    const r = await chat([GPT_OSS, GEMINI], 128);
    expect(r.content).toBe('ok gemini');
    expect(sent.map((s) => [s.provider, s.maxTokens])).toEqual([['groq', 1024], ['gemini', 128]]);
  });

  it('every real call-site budget found by the audit (10, 60, 128, 150, 256, 500, 800, 1200) and "no maxTokens" reach a reasoning model at >= 1024', async () => {
    const sent: Sent[] = [];
    stubFetch(sent);
    const budgets = [10, 60, 128, 150, 256, 500, 800, 1200, undefined];
    for (const b of budgets) await chat([GPT_OSS], b);
    expect(sent.length).toBe(budgets.length);
    expect(sent.every((s) => s.maxTokens >= REASONING_MIN_MAX_TOKENS)).toBe(true);
    expect(sent.map((s) => s.maxTokens)).toEqual([1024, 1024, 1024, 1024, 1024, 1024, 1024, 1200, 2048]);
  });
});

describe('streamWithFallback — what is actually sent', () => {
  it('(4) maxTokens 128 to groq/gpt-oss-120b is sent as >= 1024; gemini keeps 128; 2000 stays 2000', async () => {
    const sent: Sent[] = [];
    stubFetch(sent);
    expect(await stream([GPT_OSS], 128)).toBe('ok groq');
    expect(await stream([GEMINI], 128)).toBe('ok gemini');
    await stream([GPT_OSS], 2000);
    expect(sent.map((s) => [s.provider, s.maxTokens])).toEqual([['groq', 1024], ['gemini', 128], ['groq', 2000]]);
  });

  it('is per candidate on the stream path too', async () => {
    const sent: Sent[] = [];
    stubFetch(sent, { failProviders: new Set(['groq']) });
    await stream([GPT_OSS, GEMINI], 128);
    expect(sent.map((s) => [s.provider, s.maxTokens])).toEqual([['groq', 1024], ['gemini', 128]]);
  });
});

describe('accounting and cooldown', () => {
  it('usage is recorded from what the provider REPORTS, not from the raised max_tokens', async () => {
    stubFetch([], { outputTokens: 7 });
    await chat([GPT_OSS], 128);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordUsage).mock.calls[0][0]).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-120b', inputTokens: 3, outputTokens: 7 });
  });

  it('a successful reasoning-model call at the floor leaves no strike or cooldown behind', async () => {
    stubFetch([]);
    for (let i = 0; i < 3; i++) await chat([GPT_OSS], 128);
    expect(isSoftCooledDown(TENANT, 'groq', 'openai/gpt-oss-120b')).toBe(false);
  });
});

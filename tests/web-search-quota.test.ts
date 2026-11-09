// M7-13c-2a-5: Gemini QUOTA handling for web.search.
//   Live (Amro, 2026-11-02): web.search reached Gemini with the tenant's own key and got HTTP 429 "You exceeded your
//   current quota" (free tier: 20 requests/day on gemini-3.6-flash, 500/day on flash-lite). The mission page showed the
//   raw, truncated JSON and the 429 was retried, burning more quota.
// Now: a QUOTA 429 is a ToolQuotaExceededError (readable sentence, never retried); a per-minute RATE 429 stays a plain
// retryable error; the call tries gemini-flash-lite-latest first and hops ONE model at most.
// The service-role DB client and Gemini (global fetch) are faked; searchWithTenantKey and the executor are real.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  row: null as { api_key: string; model: string | null } | null,
  mode: 'sandbox' as 'live' | 'sandbox',
}));

vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/executionMode')>();
  return { ...actual, getTenantExecutionMode: vi.fn(async () => h.mode) };
});
vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from() {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: h.row, error: null }) };
      return q;
    },
  }),
}));

import { searchWithTenantKey } from '@/lib/tools/webSearchCore';
import { toolExecutor } from '@/lib/tools/executor';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { ToolQuotaExceededError, ToolNotConfiguredError } from '@/lib/tools/types';
import { geminiCooldown } from '@/lib/tools/webSearchCooldown';
// M7-13c-2a-6: the per-tenant Gemini cooldown is process-wide state — every test starts without one.
beforeEach(() => {
  geminiCooldown.reset();
  // Hermetic: vitest.config.ts loads .env.local into process.env — no real Tavily key / allow-list may reach a test.
  vi.stubEnv('TAVILY_API_KEY', '');
  vi.stubEnv('TAVILY_ALLOWED_TENANT_IDS', '');
});

const KEY = 'AIzaSy-QUOTA-SECRET-777';
const T = 'client-tenant';
const LITE = 'gemini-flash-lite-latest';
const FLASH = 'gemini-3.6-flash';

const respond = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as unknown as Response;
const OK = respond(200, { candidates: [{ content: { parts: [{ text: 'Found.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://e.com', title: 'E' } }] } }] });

// Bodies in the documented Gemini error shape (NOT taken from a repo fixture — there is none; see the ticket report).
const quotaPerDay = (extra = '') => JSON.stringify({ error: { code: 429, message: `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/usage?tab=rate-limit. ${extra}`, status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: { model: 'gemini-3.6-flash' }, quotaValue: '20' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' },
] } });
const quotaPerMinute = () => JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
] } });

const fetchMock = vi.fn();
const modelOf = (callIdx: number) => /models\/([^:]+):generateContent/.exec(fetchMock.mock.calls[callIdx][0] as string)?.[1];

beforeAll(() => { ensureBuiltinToolsRegistered(); });
beforeEach(() => {
  h.row = { api_key: KEY, model: null };
  h.mode = 'sandbox';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('a quota 429 is a ToolQuotaExceededError with a readable sentence', () => {
  it.each([
    ['PerDay quota id (documented shape)', quotaPerDay()],
    ['RESOURCE_EXHAUSTED + "exceeded your current quota", no details (Amro\'s live message)', JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED' } })],
    ['truncated JSON that still says quota', '{\n  "error": {\n    "code": 429,\n    "message": "You exceeded your current quota, please check your plan and billing details. For more infor'],
    ['plain text mentioning quota', 'Quota exceeded for quota metric generate_content_free_tier_requests'],
    ['"per day" wording without quota ids', JSON.stringify({ error: { code: 429, message: 'Request limit per day reached', status: 'RESOURCE_EXHAUSTED' } })],
  ])('%s', async (_label, body) => {
    fetchMock.mockResolvedValue(respond(429, body));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err.message).toBe(`Gemini: Gemini's request limit for models ${LITE} and ${FLASH} was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio. Tavily: not configured for this workspace.`);
    expect(err.message.length).toBeLessThan(250 + ' Tavily: not configured for this workspace.'.length);
    expect(err.message).not.toMatch(/[{}"]/);          // no JSON, ever
    expect(err.message).not.toMatch(/https?:\/\//);    // no URLs
    expect(err.message).not.toContain(KEY);
  });

  it('a body that echoes the key never carries it into the message', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerDay(`(key ${KEY})`)));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err.message).not.toContain(KEY);
  });
});

describe('a RATE-limit 429 (or an unclear one) stays a plain, retryable error', () => {
  it.each([
    ['PerMinute quota id (even though the text says "quota")', quotaPerMinute()],
    ['per-minute wording', JSON.stringify({ error: { code: 429, message: 'Too many requests per minute', status: 'RESOURCE_EXHAUSTED' } })],
    ['short retryDelay and no quota wording', JSON.stringify({ error: { code: 429, message: 'Slow down', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }] } })],
    ['429 without any quota wording', 'busy'],
    ['429 with an empty body', ''],
  ])('%s', async (_label, body) => {
    fetchMock.mockResolvedValue(respond(429, body));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ToolQuotaExceededError);
    expect(err).not.toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toContain('429');
    expect(fetchMock).toHaveBeenCalledTimes(1); // a rate limit does NOT hop to another model
  });

  it('the error text for a retryable failure is the readable message, not a raw JSON dump', async () => {
    fetchMock.mockResolvedValue(respond(503, JSON.stringify({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } })));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err.message).toBe('Gemini: Gemini grounding request failed (503): The model is overloaded. Please try again later. Tavily: not configured for this workspace.');
    expect(err.message).not.toMatch(/[{}]/);
  });
});

describe('each classification rule on its own (no other rule can give the same answer)', () => {
  it('a PerMinute quota id alone makes a 429 a RATE limit, even when the text says "exceeded your current quota" and there is no retryDelay', async () => {
    fetchMock.mockResolvedValue(respond(429, JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] } })));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).not.toBeInstanceOf(ToolQuotaExceededError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a PerDay quota id alone makes a 429 QUOTA, even when the text has no quota wording and the retryDelay is short', async () => {
    fetchMock.mockResolvedValue(respond(429, JSON.stringify({ error: { code: 429, message: 'Request failed', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' },
    ] } })));
    expect(await searchWithTenantKey(T, 'q').catch((e) => e)).toBeInstanceOf(ToolQuotaExceededError);
  });

  it('a PerDay quota id is found even in a TRUNCATED body (text scan of the raw body)', async () => {
    fetchMock.mockResolvedValue(respond(429, '{"error":{"code":429,"message":"Request failed","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"'));
    expect(await searchWithTenantKey(T, 'q').catch((e) => e)).toBeInstanceOf(ToolQuotaExceededError);
  });
});

describe('readable error text for the failures that stay retryable', () => {
  it('a TRUNCATED JSON body still yields just its message, with no braces or quotes', async () => {
    fetchMock.mockResolvedValue(respond(503, '{\n  "error": {\n    "code": 503,\n    "message": "The model is overloaded. Please try aga'));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err.message).toBe('Gemini: Gemini grounding request failed (503): The model is overloaded. Please try aga. Tavily: not configured for this workspace.');
    expect(err.message).not.toMatch(/[{}"]/);
  });

  it('URLs inside the provider message are not repeated to the user', async () => {
    fetchMock.mockResolvedValue(respond(503, JSON.stringify({ error: { code: 503, message: 'Overloaded. For more information head to: https://ai.google.dev/gemini-api/docs/troubleshooting and retry.', status: 'UNAVAILABLE' } })));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err.message).not.toMatch(/https?:\/\//);
    expect(err.message).toContain('Overloaded.');
  });

  it('the key is scrubbed BEFORE the message is shortened: a key that straddles the length cap leaves no fragment', async () => {
    fetchMock.mockResolvedValue(respond(503, JSON.stringify({ error: { code: 503, message: 'x'.repeat(196) + KEY + ' tail' } })));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err.message).not.toContain('AIza');
    expect(err.message).not.toContain(KEY);
  });
});

describe('model order and the one-hop fallback', () => {
  it('no pinned model: the first call uses gemini-flash-lite-latest', async () => {
    fetchMock.mockResolvedValue(OK);
    await searchWithTenantKey(T, 'q');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(modelOf(0)).toBe(LITE);
  });

  it('a pinned model is tried first', async () => {
    h.row = { api_key: KEY, model: 'gemini-pinned-9' };
    fetchMock.mockResolvedValue(OK);
    await searchWithTenantKey(T, 'q');
    expect(modelOf(0)).toBe('gemini-pinned-9');
  });

  it('first candidate out of quota -> the second is called ONCE and its result is returned', async () => {
    fetchMock.mockResolvedValueOnce(respond(429, quotaPerDay())).mockResolvedValueOnce(OK);
    const r = await searchWithTenantKey(T, 'q');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([modelOf(0), modelOf(1)]).toEqual([LITE, FLASH]);
    expect(r.count).toBe(1);
  });

  it('a pinned model out of quota hops to gemini-flash-lite-latest (the pin is a chat preference; search is a means to an answer)', async () => {
    h.row = { api_key: KEY, model: 'gemini-pinned-9' };
    fetchMock.mockResolvedValueOnce(respond(429, quotaPerDay())).mockResolvedValueOnce(OK);
    await searchWithTenantKey(T, 'q');
    expect([modelOf(0), modelOf(1)]).toEqual(['gemini-pinned-9', LITE]);
  });

  it('both candidates out of quota -> ToolQuotaExceededError naming both models; exactly 2 Gemini calls', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err.message).toContain(LITE);
    expect(err.message).toContain(FLASH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['404 model not found', 404, JSON.stringify({ error: { code: 404, message: 'models/gemini-flash-lite-latest is not found for API version v1beta', status: 'NOT_FOUND' } })],
    ['400 "does not support" google_search', 400, JSON.stringify({ error: { code: 400, message: 'Search Grounding is not supported for this model', status: 'INVALID_ARGUMENT' } })],
  ])('%s -> the next candidate is tried', async (_label, status, body) => {
    fetchMock.mockResolvedValueOnce(respond(status as number, body)).mockResolvedValueOnce(OK);
    const r = await searchWithTenantKey(T, 'q');
    expect(r.count).toBe(1);
    expect([modelOf(0), modelOf(1)]).toEqual([LITE, FLASH]);
  });

  it('a GENERIC 400 INVALID_ARGUMENT with unrelated wording on the first model hops to the second model and returns its result (no wording match needed)', async () => {
    fetchMock.mockResolvedValueOnce(respond(400, JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } }))).mockResolvedValueOnce(OK);
    const r = await searchWithTenantKey(T, 'q');
    expect(r.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([modelOf(0), modelOf(1)]).toEqual([LITE, FLASH]);
  });

  it('a 400 API_KEY_INVALID is still a rejected KEY: ToolNotConfiguredError with NO hop (one fetch call)', async () => {
    fetchMock.mockResolvedValue(respond(400, JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toMatch(/rejected this workspace's API key \(HTTP 400\)/);
    expect(err.message).not.toContain('Gemini said');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('BOTH models answer 400 -> ToolNotConfiguredError, exactly 2 calls, both model names and "Gemini said:" with the sanitized provider message — no braces, no URLs, no key', async () => {
    const body = JSON.stringify({ error: { code: 400, message: `Request contains an invalid argument. See https://ai.google.dev/gemini-api/docs/troubleshooting for details (key ${KEY}).`, status: 'INVALID_ARGUMENT' } });
    fetchMock.mockResolvedValue(respond(400, body));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.message).toContain(LITE);
    expect(geminiCooldown.active(T)!.message).toContain(FLASH); // Fix 2: the combined text shows the first model when space is short; the full list is on the cooldown entry
    // Fix 2: the combined text drops " Gemini said: ..." to stay within 280 characters; the full, sanitized message is kept on the cooldown entry.
    const full = geminiCooldown.active(T)!.message;
    expect(full).toContain('Gemini said: Request contains an invalid argument. See for details (key [redacted]).');
    expect(full).not.toMatch(/[{}]/);
    expect(full).not.toMatch(/https?:\/\//);
    expect(full).not.toContain(KEY);
    expect(err.message).not.toMatch(/[{}]/);
    expect(err.message).not.toMatch(/https?:\/\//);
    expect(err.message).not.toContain(KEY);
  });

  it('the all-unavailable message has the exact final wording; the LAST reason is kept on the cooldown entry (the combined text drops it to fit 280 characters)', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(400, JSON.stringify({ error: { message: 'first reason' } })))
      .mockResolvedValueOnce(respond(400, JSON.stringify({ error: { message: 'Request contains an invalid argument.' } })));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err.message).toBe(`Gemini: search grounding is not available on this workspace's Gemini key (models tried: ${LITE},…) — a free-tier key cannot run Google Search; pin a supported model or use a paid key in Settings → AI Providers. Tavily: not configured for this workspace.`);
    expect(err.message.length).toBeLessThanOrEqual(280);
    expect(geminiCooldown.active(T)!.message).toContain('Gemini said: Request contains an invalid argument.');
  });

  it('404 with an EMPTY body on both models -> "Gemini said: HTTP 404"', async () => {
    fetchMock.mockResolvedValue(respond(404, ''));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(geminiCooldown.active(T)!.message).toContain('Gemini said: HTTP 404'); // Fix 2: kept on the cooldown entry, dropped from the 280-character combined text
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a 400 with an empty body uses the status as the reason: "Gemini said: HTTP 400"', async () => {
    fetchMock.mockResolvedValue(respond(400, ''));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(geminiCooldown.active(T)!.message).toContain('Gemini said: HTTP 400'); // Fix 2: kept on the cooldown entry, dropped from the 280-character combined text
  });

  it('the mixed case is unchanged: one model out of quota + one unavailable is still the QUOTA error naming only the quota model (no "Gemini said")', async () => {
    fetchMock.mockResolvedValueOnce(respond(400, JSON.stringify({ error: { message: 'Request contains an invalid argument.' } }))).mockResolvedValueOnce(respond(429, quotaPerDay()));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err.message).toContain(FLASH);
    expect(err.message).not.toContain(LITE);
    expect(err.message).not.toContain('Gemini said');
  });

  it('first model unavailable and second out of quota -> quota error naming the model that hit quota', async () => {
    fetchMock.mockResolvedValueOnce(respond(404, 'not found')).mockResolvedValueOnce(respond(429, quotaPerDay()));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err.message).toContain(FLASH);
    expect(err.message).not.toContain(LITE);
  });

  it('both candidates unavailable -> a not-configured error (deterministic) naming the models, never a loop', async () => {
    fetchMock.mockResolvedValue(respond(404, 'not found'));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toContain(LITE);
    expect(geminiCooldown.active(T)!.message).toContain(FLASH); // Fix 2: the combined text shows the first model when space is short; the full list is on the cooldown entry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('even with a pinned model (3 distinct candidates) at most 2 Gemini calls are made, and the error names the two tried', async () => {
    h.row = { api_key: KEY, model: 'gemini-pinned-9' };
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    const err: any = await searchWithTenantKey(T, 'q').catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err.message).toContain('gemini-pinned-9');
    expect(err.message).toContain(LITE);
    expect(err.message).not.toContain(FLASH);
  });

  it('the same model is never called twice (a pin equal to a fallback is de-duplicated) and never more than 2 calls', async () => {
    h.row = { api_key: KEY, model: LITE };
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    await searchWithTenantKey(T, 'q').catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Set([modelOf(0), modelOf(1)]).size).toBe(2);
  });

  it('a rejected key (403), a 5xx or a network error does NOT hop to another model', async () => {
    for (const r of [respond(403, 'denied'), respond(500, 'boom'), respond(503, 'busy')]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(r);
      await searchWithTenantKey(T, 'q').catch(() => undefined);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await searchWithTenantKey(T, 'q').catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('through the real executor (Demo mode): a quota failure is ONE attempt with the readable sentence', () => {
  const run = (extra: Record<string, unknown> = {}) =>
    toolExecutor.execute({ id: 'req-' + Math.random(), toolId: 'web.search', agentId: 'nova', arguments: { query: 'jarvis' }, tenantId: T, retries: 3, ...extra } as never);

  it('both models out of quota: errorCode quota_exceeded, attempts = 1 (not 4), no JSON in the error, 2 Gemini calls in total', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('quota_exceeded');
    expect(r.retries).toBe(1);
    expect(r.error).toMatch(/^Gemini: Gemini's request limit for models/);
    expect(r.error).not.toMatch(/[{}"]/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a per-minute rate limit is still retried by the executor', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerMinute()));
    const r = await run({ retries: 1 });
    expect(r.errorCode).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 2 attempts x 1 model each (no hop on a rate limit)
  }, 15000);
});

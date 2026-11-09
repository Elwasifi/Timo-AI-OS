// M7-13c-2a-4: webSearchHandler — where the key is resolved depends on where the executor runs.
//   - browser (window exists): POST /api/tools/web-search with the user's session; the key never reaches the browser;
//   - server (no window, e.g. the mission task queue): the same core is called directly with the executor's trusted tenant id.
// A NOT_CONFIGURED answer from the route becomes a ToolNotConfiguredError (never retried); anything else stays a plain Error.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  authFetch: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@/lib/api/authFetch', () => ({ authFetch: h.authFetch }));
vi.mock('@/lib/tools/webSearchCore', () => ({ searchWithTenantKey: h.search }));

import { webSearchHandler } from '@/lib/tools/webSearch';
import { ToolNotConfiguredError, ToolQuotaExceededError, type ToolExecutionContext } from '@/lib/tools/types';
import { geminiCooldown } from '@/lib/tools/webSearchCooldown';
// M7-13c-2a-6: the per-tenant Gemini cooldown is process-wide state — every test starts without one.
beforeEach(() => {
  geminiCooldown.reset();
  // Hermetic: vitest.config.ts loads .env.local into process.env — no real Tavily key / allow-list may reach a test.
  vi.stubEnv('TAVILY_API_KEY', '');
  vi.stubEnv('TAVILY_ALLOWED_TENANT_IDS', '');
});

const ctx = (tenantId: string | null = 'client-tenant'): ToolExecutionContext => ({
  agentId: 'nova', requestId: 'r1', signal: new AbortController().signal, tenantId, missionId: null, taskId: null,
  isSimulation: false, executionMode: 'sandbox', onProgress: () => {},
} as unknown as ToolExecutionContext);

const RESULT = { results: [{ title: 'T', url: 'https://e.com', snippet: '' }], query: 'q', count: 1, summary: 's' };
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  h.authFetch.mockReset();
  h.search.mockReset();
  h.search.mockResolvedValue(RESULT);
});
afterEach(() => vi.unstubAllGlobals());

describe('server side (no window): calls the core directly with the executor\'s tenant', () => {
  it('passes the tenant id from the executor context, the query and maxResults — and never goes through HTTP', async () => {
    expect(await webSearchHandler({ query: 'jarvis', maxResults: 3 }, ctx('t-1'))).toEqual(RESULT);
    expect(h.search).toHaveBeenCalledWith('t-1', 'jarvis', 3);
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it('a core ToolNotConfiguredError propagates unchanged', async () => {
    h.search.mockRejectedValue(new ToolNotConfiguredError('web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.'));
    await expect(webSearchHandler({ query: 'q' }, ctx())).rejects.toBeInstanceOf(ToolNotConfiguredError);
  });

  it('a blank query is rejected before anything else', async () => {
    await expect(webSearchHandler({ query: '  ' }, ctx())).rejects.toThrow(/non-empty query/);
    expect(h.search).not.toHaveBeenCalled();
  });
});

describe('browser side (window exists): goes through the authenticated route', () => {
  beforeEach(() => vi.stubGlobal('window', {}));

  it('POSTs { tenantId, query, maxResults } to /api/tools/web-search with the abort signal, and returns the route data', async () => {
    h.authFetch.mockResolvedValue(reply(200, { success: true, data: RESULT }));
    const c = ctx('t-9');
    expect(await webSearchHandler({ query: 'jarvis', maxResults: 4 }, c)).toEqual(RESULT);
    expect(h.search).not.toHaveBeenCalled(); // the core (and so the key) is never touched in the browser
    const [url, init] = h.authFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tools/web-search');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ tenantId: 't-9', query: 'jarvis', maxResults: 4 });
    expect(init.signal).toBe(c.signal);
  });

  it('NOT_CONFIGURED (HTTP 422) -> ToolNotConfiguredError carrying the route\'s specific message', async () => {
    h.authFetch.mockResolvedValue(reply(422, { success: false, error: { code: 'NOT_CONFIGURED', message: 'web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.' } }));
    const err: any = await webSearchHandler({ query: 'q' }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toBe('web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.');
  });

  it('QUOTA_EXCEEDED (HTTP 429) -> ToolQuotaExceededError carrying the readable sentence (M7-13c-2a-5)', async () => {
    const msg = "Gemini's request limit for model gemini-flash-lite-latest was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio.";
    h.authFetch.mockResolvedValue(reply(429, { success: false, error: { code: 'QUOTA_EXCEEDED', message: msg } }));
    const err: any = await webSearchHandler({ query: 'q' }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(ToolQuotaExceededError);
    expect(err).not.toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toBe(msg);
  });

  it('a server-side core ToolQuotaExceededError propagates unchanged (no HTTP involved)', async () => {
    vi.unstubAllGlobals(); // server side: no window
    h.search.mockRejectedValue(new ToolQuotaExceededError('limit reached'));
    await expect(webSearchHandler({ query: 'q' }, ctx())).rejects.toBeInstanceOf(ToolQuotaExceededError);
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it.each([
    [502, { success: false, error: { code: 'UPSTREAM_ERROR', message: 'Gemini grounding request failed (503): busy' } }, /503/],
    [403, { success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this workspace' } }, /access/],
    [500, null, /HTTP 500/],
  ])('HTTP %i stays a plain, retryable Error (classification of everything else is unchanged)', async (status, body, re) => {
    h.authFetch.mockResolvedValue(reply(status, body));
    const err: any = await webSearchHandler({ query: 'q' }, ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toMatch(re);
  });
});

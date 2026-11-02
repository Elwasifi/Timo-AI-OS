// M7-13c-2a-4: web.search resolves the TENANT's own Gemini key (BYOK), server-side, and never leaks it.
//   Live bug (2026-11-02): web.search read the single global app_settings row, so a BYOK tenant always got
//   "no Gemini API key configured" — and the task was retried 3 times.
// The service-role DB client and Gemini (global fetch) are faked; searchWithTenantKey is real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  providerRows: [] as Array<{ tenant_id: string; provider: string; api_key: string | null; model: string | null }>,
  appSettings: { gemini_api_key: 'GLOBAL-KEY-SHOULD-NEVER-BE-USED-BY-CLIENTS', gemini_model: 'gemini-global-model' } as Record<string, unknown> | null,
  dbError: null as string | null,
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        maybeSingle: async () => {
          h.queries.push({ table, filters: { ...filters } });
          if (h.dbError) return { data: null, error: { message: h.dbError } };
          if (table === 'app_settings') return { data: h.appSettings, error: null };
          if (table === 'tenant_provider_keys') {
            const row = h.providerRows.find((r) => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
            return { data: row ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { searchWithTenantKey, WEB_SEARCH_NO_KEY_MESSAGE } from '@/lib/tools/webSearchCore';
import { ToolNotConfiguredError } from '@/lib/tools/types';
import { INTERNAL_TENANT_ID } from '@/lib/governance/internalTenant';

const TENANT = 'client-tenant';
const TENANT_KEY = 'AIzaSy-TENANT-SECRET-123456';

const geminiOk = {
  candidates: [{
    content: { parts: [{ text: 'Three projects found.' }] },
    groundingMetadata: { groundingChunks: [{ web: { uri: 'https://github.com/x/jarvis', title: 'Open-JARVIS' } }, { web: { title: 'no uri' } }] },
  }],
};
const respond = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as unknown as Response;

const fetchMock = vi.fn();
beforeEach(() => {
  h.providerRows = [{ tenant_id: TENANT, provider: 'gemini', api_key: TENANT_KEY, model: null }];
  h.appSettings = { gemini_api_key: 'GLOBAL-KEY-SHOULD-NEVER-BE-USED-BY-CLIENTS', gemini_model: 'gemini-global-model' };
  h.dbError = null;
  h.queries.length = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(respond(200, geminiOk));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('a client tenant uses ITS OWN Gemini key', () => {
  it('reads that tenant\'s gemini row (not app_settings), calls Gemini once, and returns the search result', async () => {
    const r = await searchWithTenantKey(TENANT, 'open source jarvis');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.queries).toEqual([{ table: 'tenant_provider_keys', filters: { tenant_id: TENANT, provider: 'gemini' } }]);
    expect(r).toEqual({ results: [{ title: 'Open-JARVIS', url: 'https://github.com/x/jarvis', snippet: '' }], query: 'open source jarvis', count: 1, summary: 'Three projects found.' });
  });

  it('sends the key in the x-goog-api-key HEADER — never in the URL', async () => {
    await searchWithTenantKey(TENANT, 'q');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(TENANT_KEY);
    expect(url).not.toContain(TENANT_KEY);
    expect(url).not.toMatch(/[?&]key=/);
  });

  it('uses the tenant\'s pinned model, or (none pinned) gemini-flash-lite-latest — the model chat already uses on the key (M7-13c-2a-5)', async () => {
    h.providerRows[0].model = 'gemini-pinned-1';
    await searchWithTenantKey(TENANT, 'q');
    expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-pinned-1:generateContent');
    h.providerRows[0].model = null;
    await searchWithTenantKey(TENANT, 'q');
    expect(fetchMock.mock.calls[1][0]).toContain('/models/gemini-flash-lite-latest:generateContent');
  });

  it('another tenant\'s key is never used', async () => {
    h.providerRows.push({ tenant_id: 'other-tenant', provider: 'gemini', api_key: 'OTHER-TENANT-KEY', model: null });
    await searchWithTenantKey(TENANT, 'q');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': TENANT_KEY });
  });
});

describe('missing configuration is a ToolNotConfiguredError (no fallback to the global key)', () => {
  it('a client tenant with NO gemini row fails with the specific message, calls nothing, and never reads app_settings', async () => {
    h.providerRows = [{ tenant_id: TENANT, provider: 'groq', api_key: 'groq-key', model: null }]; // other providers don't count
    const err = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toBe(WEB_SEARCH_NO_KEY_MESSAGE);
    expect(err.message).toMatch(/Settings → AI Providers/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.queries.map((q) => q.table)).toEqual(['tenant_provider_keys']); // the global app_settings key (which exists) is not even read
  });

  it.each([[''], ['   '], [null]])('a blank stored key (%j) counts as missing', async (blank) => {
    h.providerRows[0].api_key = blank as string | null;
    await expect(searchWithTenantKey(TENANT, 'q')).rejects.toBeInstanceOf(ToolNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], ['']])('no workspace (%j) -> not configured, nothing read or called', async (tid) => {
    await expect(searchWithTenantKey(tid as never, 'q')).rejects.toBeInstanceOf(ToolNotConfiguredError);
    expect(h.queries).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the INTERNAL tenant keeps using the global app_settings key and model (grandfathered, as in chat)', async () => {
    const r = await searchWithTenantKey(INTERNAL_TENANT_ID, 'q');
    expect(h.queries.map((q) => q.table)).toEqual(['app_settings']);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'GLOBAL-KEY-SHOULD-NEVER-BE-USED-BY-CLIENTS' });
    expect(fetchMock.mock.calls[0][0]).toContain('gemini-global-model');
    expect(r.count).toBe(1);
  });

  it('the internal tenant with no global key is also not configured', async () => {
    h.appSettings = { gemini_api_key: null, gemini_model: null };
    await expect(searchWithTenantKey(INTERNAL_TENANT_ID, 'q')).rejects.toBeInstanceOf(ToolNotConfiguredError);
  });

  it('a failed database READ is a plain (retryable) error, not "not configured"', async () => {
    h.dbError = 'connection reset';
    const err = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ToolNotConfiguredError);
  });
});

describe('Gemini responses are classified: bad key = deterministic, the rest stays retryable', () => {
  it.each([
    [401, { error: { message: 'Unauthorized' } }],
    [403, { error: { message: 'Forbidden' } }],
    [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }],
  ])('HTTP %i (key refused) -> ToolNotConfiguredError naming the status, with no key in it', async (status, body) => {
    fetchMock.mockResolvedValue(respond(status, body));
    const err = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toContain(`HTTP ${status}`);
    expect(err.message).toMatch(/Settings → AI Providers/);
    expect(err.message).not.toContain(TENANT_KEY);
  });

  it.each([[429], [500], [502], [503]])('HTTP %i stays a plain, retryable error', async (status) => {
    fetchMock.mockResolvedValue(respond(status, { error: { message: 'busy' } }));
    const err = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toContain(String(status));
  });

  it('a plain HTTP 400 that is NOT about the key means "this model cannot serve the request": it hops, and when every model does that it is a not-configured error — never a retried plain error (hardening after M7-13c-2a-5 review)', async () => {
    fetchMock.mockResolvedValue(respond(400, { error: { message: 'Unable to process request' } }));
    const err: any = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err).toBeInstanceOf(ToolNotConfiguredError);
    expect(err.message).toContain('Gemini said: Unable to process request');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('the key never appears in any error text', () => {
  it('an upstream error body that echoes the key is scrubbed', async () => {
    fetchMock.mockResolvedValue(respond(500, `internal error for key ${TENANT_KEY} please retry`));
    const err = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err.message).not.toContain(TENANT_KEY);
    expect(err.message).toContain('[redacted]');
  });

  it('a network error that mentions the key is scrubbed', async () => {
    fetchMock.mockRejectedValue(new Error(`getaddrinfo failed (request had ${TENANT_KEY})`));
    const err = await searchWithTenantKey(TENANT, 'q').catch((e) => e);
    expect(err.message).not.toContain(TENANT_KEY);
  });
});

describe('unchanged behaviour', () => {
  it('a blank query is rejected before anything is read or called', async () => {
    await expect(searchWithTenantKey(TENANT, '   ')).rejects.toThrow(/non-empty query/);
    expect(h.queries).toHaveLength(0);
  });

  it('maxResults is clamped to 1..20 and honoured', async () => {
    fetchMock.mockResolvedValue(respond(200, { candidates: [{ groundingMetadata: { groundingChunks: Array.from({ length: 30 }, (_, i) => ({ web: { uri: `https://e.com/${i}`, title: `t${i}` } })) } }] }));
    expect((await searchWithTenantKey(TENANT, 'q', 100)).count).toBe(20);
    expect((await searchWithTenantKey(TENANT, 'q', 0)).count).toBe(1);
    expect((await searchWithTenantKey(TENANT, 'q')).count).toBe(5);
  });

  it('grounding that finds nothing is an honest empty result, not an error', async () => {
    fetchMock.mockResolvedValue(respond(200, { candidates: [{ content: { parts: [{ text: '' }] } }] }));
    expect(await searchWithTenantKey(TENANT, 'q')).toEqual({ results: [], query: 'q', count: 0, summary: undefined });
  });
});

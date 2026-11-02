// M7-13c-2a-4: POST /api/tools/web-search — the server-side path for tools running in the browser.
// Auth and tenant membership are checked here; the tenant's key is resolved by the core and never returned.
// Real route + real core; the user, the membership table, the key table and Gemini are faked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  members: [] as Array<{ user_id: string; tenant_id: string }>,
  keyRow: null as { api_key: string; model: string | null } | null,
  coreCalls: 0,
}));

vi.mock('@/lib/auth/apiAuth', () => ({
  requireUser: vi.fn(async (req: Request) => {
    const t = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    return t ? { id: t, email: `${t}@example.com` } : null;
  }),
  isTenantMember: vi.fn(async (uid: string, tid: string) => h.members.some((m) => m.user_id === uid && m.tenant_id === tid)),
}));

vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from() {
      h.coreCalls++;
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: h.keyRow, error: null }) };
      return q;
    },
  }),
}));

import { POST } from '@/app/api/tools/web-search/route';

const KEY = 'AIzaSy-ROUTE-SECRET-987654';
const T = 'tenant-T';
const call = (user: string | null, body: unknown) =>
  POST(new Request('http://localhost/api/tools/web-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${user}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
const gemini = (status: number, body: unknown) =>
  ({ ok: status < 300, status, statusText: 'x', json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as unknown as Response;

const fetchMock = vi.fn();
beforeEach(() => {
  h.members = [{ user_id: 'u-member', tenant_id: T }];
  h.keyRow = { api_key: KEY, model: null };
  h.coreCalls = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(gemini(200, { candidates: [{ content: { parts: [{ text: 'Found.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://e.com', title: 'E' } }] } }] }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/tools/web-search — authorization', () => {
  it('unauthenticated -> 401, nothing read, nothing called', async () => {
    const res = await call(null, { tenantId: T, query: 'q' });
    expect(res.status).toBe(401);
    expect(h.coreCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a user who is not a member of the tenant', 'u-stranger', T],
    ['a tenant that does not exist (same answer: no leak)', 'u-member', 'tenant-missing'],
  ])('%s -> 403, nothing read, nothing called', async (_l, user, tenant) => {
    const res = await call(user, { tenantId: tenant, query: 'q' });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(h.coreCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing tenantId -> 400 and blank query -> 400 (after the membership check)', async () => {
    expect((await call('u-member', { query: 'q' })).status).toBe(400);
    expect((await call('u-member', { tenantId: T, query: '   ' })).status).toBe(400);
    expect((await call('u-member', undefined)).status).toBe(400);
  });
});

describe('POST /api/tools/web-search — behaviour', () => {
  it('a member whose tenant has a key gets the real search result, and the key is nowhere in the response', async () => {
    const res = await call('u-member', { tenantId: T, query: 'jarvis' });
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ results: [{ title: 'E', url: 'https://e.com', snippet: '' }], query: 'jarvis', count: 1, summary: 'Found.' });
    expect(text).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': KEY });
  });

  it('no key for the tenant -> 422 NOT_CONFIGURED with the specific, actionable message; Gemini is not called', async () => {
    h.keyRow = null;
    const res = await call('u-member', { tenantId: T, query: 'jarvis' });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_CONFIGURED');
    expect(json.error.message).toBe('web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Gemini refuses the key -> 422 NOT_CONFIGURED (deterministic), key not echoed', async () => {
    fetchMock.mockResolvedValue(gemini(403, `forbidden for ${KEY}`));
    const res = await call('u-member', { tenantId: T, query: 'jarvis' });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe('NOT_CONFIGURED');
    expect(text).not.toContain(KEY);
  });

  it('Gemini quota exhausted (429 RESOURCE_EXHAUSTED) on every candidate -> 429 QUOTA_EXCEEDED with the readable sentence, no JSON, no key (M7-13c-2a-5)', async () => {
    const quotaBody = JSON.stringify({ error: { code: 429, message: `You exceeded your current quota, please check your plan and billing details. key=${KEY}`, status: 'RESOURCE_EXHAUSTED' } });
    fetchMock.mockResolvedValue(gemini(429, quotaBody));
    const res = await call('u-member', { tenantId: T, query: 'jarvis' });
    expect(res.status).toBe(429);
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('QUOTA_EXCEEDED');
    expect(json.error.message).toMatch(/^Gemini's request limit for models gemini-flash-lite-latest and gemini-3\.6-flash was reached on this workspace's API key\./);
    expect(json.error.message).toMatch(/Settings → AI Providers/);
    expect(json.error.message).not.toMatch(/[{}"]/);
    expect(text).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one hop, each model once
  });

  it('401/403/NOT_CONFIGURED behaviour is unchanged by the quota handling (a refused key does not hop models)', async () => {
    fetchMock.mockResolvedValue(gemini(401, 'nope'));
    const res = await call('u-member', { tenantId: T, query: 'jarvis' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('NOT_CONFIGURED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Gemini 429/5xx -> 502 UPSTREAM_ERROR (transient, retried as before), key not echoed even if the provider body contains it', async () => {
    fetchMock.mockResolvedValue(gemini(503, `overloaded (key ${KEY})`));
    const res = await call('u-member', { tenantId: T, query: 'jarvis' });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe('UPSTREAM_ERROR');
    expect(text).not.toContain(KEY);
  });
});

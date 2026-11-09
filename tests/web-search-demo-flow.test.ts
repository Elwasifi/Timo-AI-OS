// M7-13c-2a-4: the Demo (sandbox) flow as the BROWSER runs it: real executor -> real built-in web.search handler ->
// authFetch -> the REAL route handler -> real core -> (faked) Gemini. Only the session (requireUser/isTenantMember),
// the service-role DB client, the tenant-mode lookup and Gemini are faked; authFetch is wired straight to the route.
// Also proves the key appears in NO log call anywhere along the way (console.* and the app logger both end up there).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'sandbox' as 'live' | 'sandbox',
  keyRow: null as { api_key: string; model: string | null } | null,
  members: [] as Array<{ user_id: string; tenant_id: string }>,
  user: 'u-member' as string | null,
  appSettingsReads: 0,
}));

vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/executionMode')>();
  return { ...actual, getTenantExecutionMode: vi.fn(async () => h.mode) };
});
vi.mock('@/lib/auth/apiAuth', () => ({
  requireUser: vi.fn(async (req: Request) => (req.headers.get('authorization') ? { id: h.user, email: 'x@example.com' } : null)),
  isTenantMember: vi.fn(async (uid: string, tid: string) => h.members.some((m) => m.user_id === uid && m.tenant_id === tid)),
}));
vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      if (table === 'app_settings') h.appSettingsReads++;
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'tenant_provider_keys' ? h.keyRow : { gemini_api_key: 'GLOBAL-KEY', gemini_model: null }, error: null }) };
      return q;
    },
  }),
}));
// The browser's authFetch, wired to the real route handler (adds the Authorization header like the real one does).
vi.mock('@/lib/api/authFetch', async () => {
  const { POST } = await import('@/app/api/tools/web-search/route');
  return { authFetch: (url: string, init: RequestInit = {}) => POST(new Request('http://localhost' + url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: 'Bearer session-token' } })) };
});

import { toolExecutor } from '@/lib/tools/executor';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { geminiCooldown } from '@/lib/tools/webSearchCooldown';
// M7-13c-2a-6: the per-tenant Gemini cooldown is process-wide state — every test starts without one.
beforeEach(() => {
  geminiCooldown.reset();
  // Hermetic: vitest.config.ts loads .env.local into process.env — no real Tavily key / allow-list may reach a test.
  vi.stubEnv('TAVILY_API_KEY', '');
  vi.stubEnv('TAVILY_ALLOWED_TENANT_IDS', '');
});

const KEY = 'AIzaSy-DEMO-FLOW-SECRET-424242';
const T = 'client-tenant';
const geminiOk = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Found.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://e.com', title: 'E' } }] } }] }) };

const fetchMock = vi.fn();
const logged: string[] = [];
const spies: Array<{ mockRestore(): void }> = [];

beforeAll(() => { ensureBuiltinToolsRegistered(); });
beforeEach(() => {
  h.mode = 'sandbox'; h.keyRow = { api_key: KEY, model: null }; h.members = [{ user_id: 'u-member', tenant_id: T }]; h.user = 'u-member'; h.appSettingsReads = 0;
  fetchMock.mockReset(); fetchMock.mockResolvedValue(geminiOk);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {}); // the executor is running in the BROWSER
  logged.length = 0;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }));
  }
});
afterEach(() => { vi.unstubAllGlobals(); spies.splice(0).forEach((s) => s.mockRestore()); });

const search = (extra: Record<string, unknown> = {}) =>
  toolExecutor.execute({ id: 'req-' + Math.random(), toolId: 'web.search', agentId: 'nova', arguments: { query: 'open source jarvis' }, tenantId: T, retries: 3, ...extra } as never);

describe('Demo (sandbox) web.search through the real route', () => {
  it('with the tenant\'s key: the search really runs, the true mode is reported, the key is only in the Gemini request header', async () => {
    const r = await search();
    expect(r.ok).toBe(true);
    expect(r.executionMode).toBe('sandbox');
    expect(r.simulated).toBeUndefined();
    expect((r.data as { count: number }).count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': KEY });
    expect(fetchMock.mock.calls[0][0]).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(h.appSettingsReads).toBe(0); // a client tenant never reads the global app_settings
  });

  it('without a key: ONE attempt, not_configured, the specific message — and no fallback to app_settings', async () => {
    h.keyRow = null;
    const r = await search();
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('not_configured');
    expect(r.error).toBe('Gemini: web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers. Tavily: not configured for this workspace.');
    expect(r.retries).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.appSettingsReads).toBe(0);
  });

  it('Gemini refusing the key (403): one attempt, not_configured', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => `denied ${KEY}` });
    const r = await search();
    expect(r.errorCode).toBe('not_configured');
    expect(r.retries).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Gemini 503: still retried by the executor (transient), key never in the error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable', text: async () => `busy ${KEY}` });
    const r = await search({ retries: 1 });
    expect(r.errorCode).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.error).not.toContain(KEY);
  }, 15000);

  it('quota exhausted on Gemini (429) in Demo: ONE executor attempt, errorCode quota_exceeded, the readable sentence — never raw JSON — and the key is not in the envelope (M7-13c-2a-5)', async () => {
    const body = JSON.stringify({ error: { code: 429, message: `You exceeded your current quota, please check your plan and billing details. (key ${KEY})`, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
    fetchMock.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => body });
    const r = await search();
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('quota_exceeded');
    expect(r.retries).toBe(1);
    expect(r.error).toMatch(/^Gemini: Gemini's request limit for models gemini-flash-lite-latest and gemini-3\.6-flash was reached on this workspace's API key\./);
    expect(r.error).not.toMatch(/[{}"]/);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one hop, each model once — not 4 attempts x 2 models
  });

  it('a user who is not a member of the tenant cannot use its key at all (403 from the route; Gemini never called)', async () => {
    h.user = 'u-stranger';
    const r = await search({ retries: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/access to this workspace/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('live mode uses the same route and reports "live"', async () => {
    h.mode = 'live';
    const r = await search();
    expect(r.ok).toBe(true);
    expect(r.executionMode).toBe('live');
  });
});

describe('the key is never logged', () => {
  it('across success, missing key, refused key and transient failure, no console/logger call contains the key', async () => {
    await search();
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'x', text: async () => `denied ${KEY}` });
    await search();
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'x', text: async () => `boom ${KEY}` });
    await search({ retries: 0 });
    h.keyRow = null;
    await search();
    expect(logged.length).toBeGreaterThan(0); // the executor / logger really did log something
    expect(logged.filter((l) => l.includes(KEY))).toEqual([]);
  });
});

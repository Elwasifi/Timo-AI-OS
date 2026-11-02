// M7-13c-2a-4: the live failure end-to-end through the REAL executor and the REAL built-in web.search tool:
//   a client tenant in Demo (sandbox) mode with no Gemini key used to fail with
//   "web.search is not available — no Gemini API key configured" and be retried 3 times (Retries 3/3).
// Now: ONE attempt, errorCode 'not_configured', the specific message, and Gemini is never called.
// Only the tenant-mode lookup, approvals, the service-role DB client and global fetch are faked.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'sandbox' as 'live' | 'sandbox',
  keyRow: null as { api_key: string; model: string | null } | null,
  handlerCalls: 0,
}));

vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/executionMode')>();
  return { ...actual, getTenantExecutionMode: vi.fn(async () => h.mode) };
});
vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from() {
      h.handlerCalls++;
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: h.keyRow, error: null }) };
      return q;
    },
  }),
}));

import { toolExecutor } from '@/lib/tools/executor';
import { toolRegistry } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { ToolNotConfiguredError, type ToolDefinition } from '@/lib/tools/types';

const NO_KEY = 'web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.';
const fetchMock = vi.fn();

beforeAll(() => { ensureBuiltinToolsRegistered(); });
beforeEach(() => {
  h.mode = 'sandbox'; h.keyRow = null; h.handlerCalls = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const search = (extra: Record<string, unknown> = {}) =>
  toolExecutor.execute({ id: 'req-' + Math.random(), toolId: 'web.search', agentId: 'nova', arguments: { query: 'open source jarvis' }, tenantId: 'client-tenant', retries: 3, ...extra } as never);

describe('web.search for a client tenant with no Gemini key', () => {
  it.each([['sandbox (Demo)'], ['live']])('%s: ONE attempt (retries asked: 3), errorCode not_configured, specific message, Gemini never called', async (label) => {
    h.mode = label.startsWith('live') ? 'live' : 'sandbox';
    const r = await search();
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('not_configured');
    expect(r.error).toBe(NO_KEY);
    expect(r.retries).toBe(1); // exactly one attempt — not "Retries 3/3"
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with the tenant\'s key the same call really searches (Demo mode, readOnly tool runs for real) and reports the true mode', async () => {
    h.keyRow = { api_key: 'AIzaSy-E2E-KEY', model: null };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://e.com', title: 'E' } }] } }] }) });
    const r = await search();
    expect(r.ok).toBe(true);
    expect(r.executionMode).toBe('sandbox');
    expect(r.simulated).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain('AIzaSy-E2E-KEY');
  });

  it('Gemini refusing the key (HTTP 403) is also one attempt, not_configured, and the key is not in the envelope', async () => {
    h.keyRow = { api_key: 'AIzaSy-REFUSED-KEY', model: null };
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => 'denied for AIzaSy-REFUSED-KEY' });
    const r = await search();
    expect(r.errorCode).toBe('not_configured');
    expect(r.retries).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain('AIzaSy-REFUSED-KEY');
  });

  it('a transient Gemini failure (503) is STILL retried — only configuration problems stop early', async () => {
    h.keyRow = { api_key: 'AIzaSy-RETRY-KEY', model: null };
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable', text: async () => 'busy' });
    const r = await search({ retries: 1 });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);
});

describe('executor: any tool throwing ToolNotConfiguredError is never retried', () => {
  it('handler called once with retries: 3; typed errorCode; message preserved', async () => {
    const handler = vi.fn(async () => { throw new ToolNotConfiguredError('X needs a key — add one in Settings.'); });
    const def: ToolDefinition = {
      id: 'test.needsKey', name: 'x', description: 'x', category: 'web', permissions: ['web'], requiredParams: [], optionalParams: [],
      responseSchema: { type: 'object', fields: {} }, status: 'active', version: '1.0.0', supportedAgents: [],
    };
    toolRegistry.register(def, handler);
    const r = await toolExecutor.execute({ id: 'r', toolId: 'test.needsKey', agentId: 'nova', arguments: {}, tenantId: 't', executionMode: 'live', retries: 3 } as never);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r.errorCode).toBe('not_configured');
    expect(r.error).toBe('X needs a key — add one in Settings.');
    toolRegistry.unregister('test.needsKey');
  });
});

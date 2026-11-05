// M7-13c-2b-1b: the observed case end to end through the REAL executor and the REAL web.search core.
// A plan with five web.search calls (different queries) while the tenant's Gemini quota is exhausted must make ONE
// tool call (= at most 2 Gemini requests: flash-lite, then the one-hop fallback model), skip the other four, fail with
// the readable quota sentence ONCE and with the non-retryable kind. Only the planner, the DB client and global fetch
// are faked; decideTools, the executor, the registry and searchWithTenantKey are real.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ row: null as { api_key: string; model: string | null } | null }));

vi.mock('@/lib/governance/approvals', () => ({ requestApproval: vi.fn(async () => ({ id: 'approval-1' })) }));
vi.mock('@/lib/governance/executionMode', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/executionMode')>();
  return { ...actual, getTenantExecutionMode: vi.fn(async () => 'sandbox') };
});
vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from() {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: h.row, error: null }) };
      return q;
    },
  }),
}));
vi.mock('@/lib/tools/planner', async (orig) => {
  const actual = await orig<typeof import('@/lib/tools/planner')>();
  return { ...actual, toolPlanner: { plan: vi.fn() } };
});

import { decideTools } from '@/lib/context/tool-decision';
import { toolPlanner } from '@/lib/tools/planner';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { cleanReason } from '@/lib/swarm/missionOutcome';
import type { DetectedIntent } from '@/lib/context/types';

const KEY = 'AIzaSy-PLAN-SECRET-999';
const fetchMock = vi.fn();
const respond = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as unknown as Response;
const quotaPerDay = () => JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
] } });
const intent = { asksForToolAction: true, toolCategoryHint: 'web', asksAboutTimeline: false } as unknown as DetectedIntent;
const SENTENCE = "Gemini's request limit for models gemini-flash-lite-latest and gemini-3.6-flash was reached on this workspace's API key.";
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

beforeAll(() => { ensureBuiltinToolsRegistered(); });
beforeEach(() => {
  h.row = { api_key: KEY, model: null };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(toolPlanner.plan).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('five web.search calls while the Gemini quota is exhausted', () => {
  const planFive = (queries: string[]) => vi.mocked(toolPlanner.plan).mockResolvedValue({
    tools: queries.map((q) => ({ toolId: 'web.search', arguments: { query: q } })), explanation: 'x',
  } as never);

  it('different queries: ONE tool call, at most 2 Gemini fetches, the sentence once, kind quota_exceeded', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    planFive(['code quality tools', 'static analysis', 'linting best practices', 'code review checklist', 'technical debt']);
    const r = await decideTools('Review code quality and identify issues', intent, 'nova', 'client-tenant');
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);       // flash-lite, then the one-hop fallback; nothing else
    expect(r.executions).toHaveLength(1);
    expect(r.success).toBe(false);
    expect(r.failureKind).toBe('quota_exceeded');
    expect(count(r.error as string, SENTENCE)).toBe(1);
    expect(r.error).not.toMatch(/repeated/);
    expect(r.error).not.toMatch(/[{}"]/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('identical queries: the duplicates are dropped before execution; same single attempt chain', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    planFive(Array(5).fill('code quality'));
    const r = await decideTools('Review code quality and identify issues', intent, 'nova', 'client-tenant');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.executions).toHaveLength(1);
    expect(count(r.error as string, SENTENCE)).toBe(1);
  });

  it('the stored task text goes through the renderers\' reason cleaner as ONE sentence', async () => {
    fetchMock.mockResolvedValue(respond(429, quotaPerDay()));
    planFive(['a', 'b', 'c', 'd', 'e']);
    const r = await decideTools('Review code quality and identify issues', intent, 'nova', 'client-tenant');
    expect(count(cleanReason(r.error), SENTENCE)).toBe(1);
  });

  it('a retryable (503) failure is still not treated as deterministic: later calls DO run', async () => {
    fetchMock.mockResolvedValue(respond(503, JSON.stringify({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } })));
    planFive(['a', 'b']);
    const r = await decideTools('Review code quality and identify issues', intent, 'nova', 'client-tenant');
    expect(r.executions).toHaveLength(2);
    expect(r.failureKind).toBe('tool_error');
  });
});

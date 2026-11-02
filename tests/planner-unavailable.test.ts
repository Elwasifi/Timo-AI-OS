// M7-13c-1: when the tool planner's AI call fails because every provider is down /
// slow, the mission task must say the PLANNER WAS UNAVAILABLE (and can be
// retried) — not "No matching tool could be planned or matched", which is
// reserved for "planning worked and nothing fit". The real planner and the real
// provider chain run; only the network, registry and health data are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelHealth } from '@/lib/ai/router/types';

const healthRows = new Map<string, ModelHealth>();
vi.mock('@/lib/ai/router/healthTracker', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/router/healthTracker')>();
  return { ...actual, getAllHealth: async () => healthRows, getHealth: async () => null, recordHealth: vi.fn() };
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
vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => [{ id: 'web.search', name: 'Search', description: 'd', requiredParams: [], optionalParams: [] }]),
    list: vi.fn(() => [{ id: 'web.search', category: 'web' }]),
    get: vi.fn(() => undefined),
  },
}));
vi.mock('@/lib/tools/builtin-tools', () => ({ ensureBuiltinToolsRegistered: vi.fn() }));
vi.mock('@/lib/tools/permissions', () => ({ permissionEngine: { getPermissions: vi.fn(() => []) } }));
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));
vi.mock('@/lib/tools/chain', () => ({ createChain: vi.fn() }));
vi.mock('@/lib/ai/router', () => ({
  route: vi.fn(async () => ({
    candidates: [
      { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
    ],
    taskType: 'TOOL_EXECUTION',
    mode: 'automatic',
  })),
  classifyTask: vi.fn(() => ({})),
}));

import { toolPlanner, ToolPlanningError } from '@/lib/tools/planner';
import { decideTools, PLANNER_UNAVAILABLE_PREFIX } from '@/lib/context/tool-decision';
import { resetProviderCircuits } from '@/lib/ai/ai-provider';
import type { DetectedIntent } from '@/lib/context/types';

const webIntent = { asksForToolAction: true, toolCategoryHint: 'web', asksAboutTimeline: false } as unknown as DetectedIntent;
const realFetch = globalThis.fetch;

const stall = (signal?: AbortSignal | null) =>
  new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

beforeEach(() => { vi.useFakeTimers(); resetProviderCircuits(); healthRows.clear(); });
afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

describe('tool planning when the AI is unavailable', () => {
  it('gives up within ~20s (not 30s) and reports planner_unavailable — and the request asked for 1200 tokens, with no reasoning flag', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return stall(init?.signal);
    }) as unknown as typeof fetch;

    const t0 = Date.now();
    let settledAt = 0;
    const p = toolPlanner.plan('find an open source jarvis assistant', 'nova', [], 'client-tenant');
    const assertion = expect(p).rejects.toMatchObject({ name: 'ToolPlanningError', code: 'planner_unavailable' });
    void p.catch(() => { settledAt = Date.now(); });
    await vi.advanceTimersByTimeAsync(21_000);
    await assertion;

    expect(settledAt - t0).toBeLessThanOrEqual(20_000);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    expect(bodies.every((b) => b.maxTokens === 1200)).toBe(true);
    expect(bodies.every((b) => !('reasoning_effort' in b) && !('reasoningEffort' in b))).toBe(true);
  });

  it('decideTools says the planner was unavailable and the task can be retried — NOT "no matching tool"', async () => {
    globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => stall(init?.signal)) as unknown as typeof fetch;
    const p = decideTools('search for an open source jarvis assistant', webIntent, 'nova', 'client-tenant');
    await vi.advanceTimersByTimeAsync(21_000);
    const result = await p;

    expect(result.outcome).toBe('attempted_failed');
    expect(result.error).toContain(PLANNER_UNAVAILABLE_PREFIX);
    expect(result.error).toMatch(/can be retried/i);
    expect(result.error).not.toMatch(/No matching tool/i);
  });

  it('a plan that SUCCEEDS with no tool keeps the "no matching tool" wording', async () => {
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: '{"tools":[],"explanation":"no matching tool"}', usage: { inputTokens: 1, outputTokens: 1 }, model: b.model }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await decideTools('search for an open source jarvis assistant', webIntent, 'nova', 'client-tenant');
    expect(result.error).toBe('No matching tool could be planned or matched for this request.');
    expect(result.error).not.toContain(PLANNER_UNAVAILABLE_PREFIX);
  });

  it('only the unavailable case carries the new code: an unparseable answer is still a plain ToolPlanningError', async () => {
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: 'sorry, I cannot help with that', usage: { inputTokens: 1, outputTokens: 1 }, model: b.model }), { status: 200 });
    }) as unknown as typeof fetch;
    const err = await toolPlanner.plan('x', 'nova', [], 'client-tenant').catch((e) => e);
    expect(err).toBeInstanceOf(ToolPlanningError);
    expect(err.code).not.toBe('planner_unavailable');
  });
});

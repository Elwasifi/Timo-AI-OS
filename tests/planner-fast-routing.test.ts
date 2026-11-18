// M7-13c-2c-b (B2) — the tool planner prefers the FAST proven model, with an automatic fallback to its previous routing choice.
//
// Live: the planner's call (it blocks the whole turn) ran on a Gemini model averaging ~7 s (10 s that day) while Groq gpt-oss-120b averages
// ~1.8 s. The planner now routes its call as latency-sensitive, so the router weighs MEASURED latency in its task-fit term (scoring.ts
// scoreTaskMatch) instead of the neutral 0.5 every candidate got. The planner prompt and its output schema are untouched. No model id is hardcoded.
//
//   1 weights   real scoreCandidate with fixture health taken from the live numbers: before (normal) vs after (high)
//   2 happy     the planner routes with latencySensitivity 'high' and uses the router's candidates; valid JSON -> one call
//   3 fallback  invalid JSON from the fast model -> ONE retry with the PREVIOUS routing choice, skipping the model that failed
//   4 timeout   the fast model hangs -> the real provider chain walks to the next candidate after the 12 s per-attempt limit

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scoreCandidate } from '@/lib/ai/router/scoring';
import type { ModelCapabilityProfile, ModelHealth, TaskClassification } from '@/lib/ai/router/types';

const h = vi.hoisted(() => ({
  route: vi.fn(),
  chat: vi.fn(),
  useRealChat: false,
}));

vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => [{ id: 'web.search', name: 'Search', description: 'd', requiredParams: [{ name: 'query', type: 'string' }], optionalParams: [] }]),
    list: vi.fn(() => []),
    get: vi.fn(() => undefined),
  },
}));
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));
vi.mock('@/lib/tools/chain', () => ({ createChain: vi.fn() }));
vi.mock('@/lib/ai/router', () => ({
  route: h.route,
  classifyTask: vi.fn(() => ({ taskType: 'TOOL_EXECUTION', latencySensitivity: 'normal', needsTools: true, needsStructuredOutput: true })),
}));
vi.mock('@/lib/ai/ai-provider', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/ai-provider')>();
  return { ...actual, chatWithFallback: (...a: Parameters<typeof actual.chatWithFallback>) => (h.useRealChat ? actual.chatWithFallback(...a) : h.chat(...a)) };
});
vi.mock('@/lib/ai/usageLedger', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/ai/router/healthTracker', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/router/healthTracker')>();
  return { ...actual, getAllHealth: async () => new Map(), getHealth: async () => null, recordHealth: vi.fn() };
});
vi.mock('@/lib/governance/entitlements', () => ({ checkBudget: vi.fn(async () => ({ withinBudget: true, spendUsd: 0, limitUsd: null })) }));
vi.mock('@/lib/settings/tenantConfiguredProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/tenantConfiguredProviders')>();
  return { ...actual, loadTenantProviderConfig: async () => [{ provider: 'groq' as const, model: null }, { provider: 'gemini' as const, model: null }] };
});
vi.mock('@/lib/settings/settings-service', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/settings-service')>();
  return { ...actual, loadSettings: async () => ({ ...actual.DEFAULT_SETTINGS, active_provider: 'groq', groq_api_key: 'k', gemini_api_key: 'k' }) };
});

import { toolPlanner, ToolPlanningError } from '@/lib/tools/planner';
import { resetProviderCircuits } from '@/lib/ai/ai-provider';

const GROQ = { provider: 'groq' as const, model: 'openai/gpt-oss-120b' };
const GEMINI = { provider: 'gemini' as const, model: 'gemini-flash-lite-latest' };
const TENANT = 'client-tenant';
const VALID = JSON.stringify({ tools: [{ toolId: 'web.search', arguments: { query: 'jarvis' } }], explanation: 'search' });
const chatOk = (content: string, who: { provider: 'groq' | 'gemini'; model: string } = GROQ) => ({ content, usage: { inputTokens: 1, outputTokens: 1 }, provider: who.provider, model: who.model });

describe('1 - routing weights: before (normal sensitivity) vs after (high sensitivity), real scoreCandidate, live health numbers', () => {
  const cap = (p: ModelCapabilityProfile['provider'], m: string): ModelCapabilityProfile => ({
    provider: p, modelId: m, available: true, validationStatus: 'connected', lastValidatedAt: new Date().toISOString(), free: true, inputPrice: null, outputPrice: null,
    contextLength: 128_000, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, supportsVision: 'unknown', supportsAudio: 'unknown',
    inferredReasoningStrength: 'standard', inferredCodingStrength: 'standard', inferredSpeedTier: 'unknown', multilingual: true,
  });
  const health = (p: ModelCapabilityProfile['provider'], m: string, ok: number, bad: number, avg: number): ModelHealth => ({
    provider: p, modelId: m, successCount: ok, failureCount: bad, consecutiveFailures: 0, avgLatencyMs: avg, lastSuccessAt: null, lastFailureAt: null, lastStatusCode: null,
  });
  const base: TaskClassification = {
    taskType: 'TOOL_EXECUTION', complexity: 'simple', urgency: 'medium', expectedContextSize: 'medium', needsTools: true, needsReasoning: false,
    needsStructuredOutput: true, needsVision: false, latencySensitivity: 'normal', costSensitivity: 'normal', reliabilityRequirement: 'high',
  };
  const score = (c: TaskClassification) => ({
    groq: scoreCandidate(cap('groq', GROQ.model), health('groq', GROQ.model, 116, 6, 1751), c, 0, 'balanced'),
    gemini: scoreCandidate(cap('gemini', GEMINI.model), health('gemini', GEMINI.model, 64, 4, 7131.7), c, 0, 'balanced'),
  });

  it('the latency-sensitive classification widens Groq\'s lead over the ~7 s Gemini model (task-fit term only; nothing else changes)', () => {
    const before = score(base);
    const after = score({ ...base, latencySensitivity: 'high' });
    const marginBefore = before.groq.score - before.gemini.score;
    const marginAfter = after.groq.score - after.gemini.score;
    expect(after.groq.score).toBeGreaterThan(after.gemini.score);
    expect(marginAfter).toBeGreaterThan(marginBefore);
    // only scoreTaskMatch's input changed: every other breakdown term is identical
    for (const k of Object.keys(before.groq.breakdown)) {
      if (k === 'taskMatch') continue;
      expect(after.groq.breakdown[k]).toBeCloseTo(before.groq.breakdown[k], 10);
      expect(after.gemini.breakdown[k]).toBeCloseTo(before.gemini.breakdown[k], 10);
    }
    expect(after.gemini.breakdown.taskMatch).toBeLessThan(before.gemini.breakdown.taskMatch);   // 0.5 -> 0.2 for a measured ~7 s model
  });
});

describe('2 - happy path', () => {
  beforeEach(() => {
    h.useRealChat = false;
    h.route.mockReset(); h.chat.mockReset();
    h.route.mockResolvedValue({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' });
  });

  it('routes the planner call as latency-sensitive and hands the router\'s candidates to the provider chain; valid JSON -> ONE model call', async () => {
    h.chat.mockResolvedValue(chatOk(VALID));
    const plan = await toolPlanner.plan('search for jarvis', 'echo', [], TENANT);
    expect(plan?.tools).toEqual([{ toolId: 'web.search', arguments: { query: 'jarvis' } }]);
    expect(h.route).toHaveBeenCalledTimes(1);
    expect(h.route.mock.calls[0][0].classification.latencySensitivity).toBe('high');
    expect(h.route.mock.calls[0][0].tenantId).toBe(TENANT);
    expect(h.chat).toHaveBeenCalledTimes(1);
    const opts = h.chat.mock.calls[0][1];
    expect(opts.candidates).toEqual([GROQ, GEMINI]);
    expect(opts.usageContext.operation).toBe('tool_planning');
    expect(opts.usageContext.metadata.plannerRouting).toBe('fast');
  });

  it('the planner prompt and output schema are untouched', async () => {
    h.chat.mockResolvedValue(chatOk(VALID));
    await toolPlanner.plan('search for jarvis', 'echo', [], TENANT);
    const opts = h.chat.mock.calls[0][1];
    expect(opts.systemPrompt).toContain('Respond with ONLY a JSON object (no markdown, no backticks):');
    expect(opts.systemPrompt).toContain('{"tools":[{"toolId":"...","arguments":{...}}],"explanation":"one sentence"}');
    expect(opts.temperature).toBe(0.1);
    expect(opts.maxTokens).toBe(1200);
  });
});

describe('3 - fallback to the previous choice when the fast model\'s output is not a usable plan', () => {
  beforeEach(() => {
    h.useRealChat = false;
    h.route.mockReset(); h.chat.mockReset();
  });

  it('invalid JSON from the fast model -> one retry on the PREVIOUS routing order (normal sensitivity), skipping the model that just failed', async () => {
    h.route
      .mockResolvedValueOnce({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' })          // fast routing
      .mockResolvedValueOnce({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' });         // previous routing
    h.chat.mockResolvedValueOnce(chatOk('Sure! I will search the web for you.', GROQ)).mockResolvedValueOnce(chatOk(VALID, GEMINI));
    const plan = await toolPlanner.plan('search for jarvis', 'echo', [], TENANT);
    expect(plan?.tools[0].toolId).toBe('web.search');
    expect(h.chat).toHaveBeenCalledTimes(2);
    expect(h.route).toHaveBeenCalledTimes(2);
    expect(h.route.mock.calls[0][0].classification.latencySensitivity).toBe('high');
    expect(h.route.mock.calls[1][0].classification.latencySensitivity).toBe('normal');        // the previous classification
    expect(h.chat.mock.calls[1][1].candidates).toEqual([GEMINI]);                              // the model that returned junk is skipped
    expect(h.chat.mock.calls[1][1].usageContext.metadata.plannerRouting).toBe('previous');
  });

  it('both answers unusable -> a plain ToolPlanningError (not "planner unavailable"), after exactly two model calls', async () => {
    h.route.mockResolvedValue({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' });
    h.chat.mockResolvedValueOnce(chatOk('nope', GROQ)).mockResolvedValueOnce(chatOk('still nope', GEMINI));
    const err = await toolPlanner.plan('search for jarvis', 'echo', [], TENANT).catch((e) => e);
    expect(err).toBeInstanceOf(ToolPlanningError);
    expect(err.code).toBeUndefined();
    expect(h.chat).toHaveBeenCalledTimes(2);
  });

  it('no alternative model exists (the failed one was the only candidate) -> the parse error is thrown, no second call', async () => {
    h.route.mockResolvedValue({ candidates: [GROQ], taskType: 'TOOL_EXECUTION', mode: 'automatic' });
    h.chat.mockResolvedValue(chatOk('nope', GROQ));
    await expect(toolPlanner.plan('search for jarvis', 'echo', [], TENANT)).rejects.toBeInstanceOf(ToolPlanningError);
    expect(h.chat).toHaveBeenCalledTimes(1);
  });

  it('a legitimate "no tool fits" answer is NOT a failure: no retry', async () => {
    h.route.mockResolvedValue({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' });
    h.chat.mockResolvedValue(chatOk(JSON.stringify({ tools: [], explanation: 'no matching tool' })));
    const plan = await toolPlanner.plan('hello there', 'echo', [], TENANT);
    expect(plan?.tools).toEqual([]);
    expect(h.chat).toHaveBeenCalledTimes(1);
  });

  it('a provider-chain failure is still reported as planner_unavailable (the chain already tried every candidate)', async () => {
    h.route.mockResolvedValue({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' });
    h.chat.mockRejectedValue(new Error('AI request failed: groq down'));
    const err = await toolPlanner.plan('search for jarvis', 'echo', [], TENANT).catch((e) => e);
    expect(err).toBeInstanceOf(ToolPlanningError);
    expect(err.code).toBe('planner_unavailable');
    expect(h.chat).toHaveBeenCalledTimes(1);
  });
});

describe('4 - the fast model times out: the real provider chain falls back to the next candidate', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
    resetProviderCircuits();
    h.useRealChat = true;
    h.route.mockReset();
    h.route.mockResolvedValue({ candidates: [GROQ, GEMINI], taskType: 'TOOL_EXECUTION', mode: 'automatic' });
  });
  afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; h.useRealChat = false; });

  it('groq hangs -> aborted at the 12 s tool_planning limit -> gemini returns the plan', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn((_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push(body.provider);
      if (body.provider === 'groq') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return Promise.resolve(new Response(JSON.stringify({ content: VALID, usage: { inputTokens: 1, outputTokens: 1 }, model: body.model }), { status: 200 }));
    }) as unknown as typeof fetch;
    const p = toolPlanner.plan('search for jarvis', 'echo', [], TENANT);
    await vi.advanceTimersByTimeAsync(13_000);
    const plan = await p;
    expect(plan?.tools[0].toolId).toBe('web.search');
    expect(seen).toEqual(['groq', 'gemini']);
  });
});

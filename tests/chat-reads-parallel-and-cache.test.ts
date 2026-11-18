// M7-13c-2c-b (B4) — the serial, repeated database reads before a chat reply's first model call.
//
// Before: generateStreamResponse awaited loadSettings, then (inside withRecentMissions) up to two missions reads, then the client-profile read,
// one after the other; route() and streamWithFallback() then read app_settings again, and checkBudget ran twice.
// Now: settings + recent-missions + client profile are started TOGETHER (Promise.all; the missions block keeps its own 4 s deadline and fails
// open), the loaded settings are passed down to route() and streamWithFallback(), and three SHORT TTL caches (lib/ai/chatReads.ts) absorb the
// rest: settings 20 s, client profile 30 s, budget 5 s (an enforcement gate), all keyed by TENANT.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  tenant: 'tenant-A' as string | null,
  loadSettings: vi.fn(),
  getClientProfile: vi.fn(),
  loadRecentMissionsBlock: vi.fn(),
  checkBudget: vi.fn(),
  route: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ currentTenantId: h.tenant }) } }));
vi.mock('@/lib/settings/settings-service', async (orig) => {
  const actual = await orig<typeof import('@/lib/settings/settings-service')>();
  return { ...actual, loadSettings: h.loadSettings };
});
vi.mock('@/lib/governance/clientProfile', async (orig) => {
  const actual = await orig<typeof import('@/lib/governance/clientProfile')>();
  return { ...actual, getClientProfile: h.getClientProfile };
});
vi.mock('@/lib/governance/entitlements', () => ({ checkBudget: h.checkBudget }));
vi.mock('@/lib/crew/recentMissions', () => ({ loadRecentMissionsBlock: h.loadRecentMissionsBlock }));
vi.mock('@/lib/ai/router', () => ({
  route: h.route,
  classifyTask: vi.fn(() => ({ taskType: 'FAST_CHAT', latencySensitivity: 'high' })),
}));
vi.mock('@/lib/ai/ai-provider', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/ai-provider')>();
  return { ...actual, streamWithFallback: h.stream, chatWithFallback: vi.fn() };
});
vi.mock('@/lib/ai/conversation-service', () => ({ ConversationService: {} }));
vi.mock('@/lib/agents/agentRegistryService', () => ({ loadAgents: vi.fn(async () => []) }));

import { CrewCoordinator } from '@/lib/crew/crew-coordinator';
import { DEFAULT_SETTINGS } from '@/lib/settings/settings-service';
import {
  loadSettingsCached, getClientProfileCached, checkBudgetCached, invalidateClientProfile,
  settingsReadCache, clientProfileReadCache, budgetReadCache,
  SETTINGS_CACHE_TTL_MS, CLIENT_PROFILE_CACHE_TTL_MS, BUDGET_CACHE_TTL_MS,
} from '@/lib/ai/chatReads';
import { clearAllTtlCaches } from '@/lib/utils/ttlCache';
import type { Agent } from '@/types';

const SETTINGS = { ...DEFAULT_SETTINGS, temperature: 0.3, max_tokens: 777 };
const temo = { id: 'temo', name: 'Temo', role: 'CEO', description: 'd' } as unknown as Agent;
const echo = { id: 'echo', name: 'Echo', role: 'Content', description: 'd', personality: { traits: [] }, skills: [], capabilities: [] } as unknown as Agent;

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const turn = (agent: Agent = temo) =>
  (new CrewCoordinator() as unknown as { generateStreamResponse: (...a: unknown[]) => Promise<string> })
    .generateStreamResponse(agent, 'hello', agent.id, '', [], false);

let now = 1_000_000;
const clock = () => now;

beforeEach(() => {
  h.tenant = 'tenant-A';
  for (const f of [h.loadSettings, h.getClientProfile, h.loadRecentMissionsBlock, h.checkBudget, h.route, h.stream]) f.mockReset();
  h.loadSettings.mockResolvedValue(SETTINGS);
  h.getClientProfile.mockResolvedValue(null);
  h.loadRecentMissionsBlock.mockResolvedValue('');
  h.checkBudget.mockResolvedValue({ withinBudget: true, spendUsd: 0, limitUsd: null, alertTriggered: false });
  h.route.mockResolvedValue({ candidates: [{ provider: 'groq', model: 'm' }], taskType: 'FAST_CHAT', mode: 'automatic' });
  h.stream.mockResolvedValue('ok');
  clearAllTtlCaches();
  now = 1_000_000;
  for (const c of [settingsReadCache, clientProfileReadCache, budgetReadCache]) c.setClockForTesting(clock);
});
afterEach(() => { for (const c of [settingsReadCache, clientProfileReadCache, budgetReadCache]) c.setClockForTesting(Date.now); });

describe('B4 - the three pre-model reads run CONCURRENTLY', () => {
  it('settings, recent missions and the client profile are all STARTED before any of them resolves', async () => {
    const s = deferred<typeof SETTINGS>(); const m = deferred<string>(); const p = deferred<null>();
    h.loadSettings.mockReturnValue(s.promise);
    h.loadRecentMissionsBlock.mockReturnValue(m.promise);
    h.getClientProfile.mockReturnValue(p.promise);
    const done = turn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // all three loads have been issued while NONE has settled (serial code would have issued only the first)
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
    expect(h.loadRecentMissionsBlock).toHaveBeenCalledTimes(1);
    expect(h.getClientProfile).toHaveBeenCalledTimes(1);
    expect(h.route).not.toHaveBeenCalled();
    s.resolve(SETTINGS); m.resolve(''); p.resolve(null);
    await done;
    expect(h.route).toHaveBeenCalledTimes(1);
  });

  it('only Temo reads the recent-missions block (other agents never start that load)', async () => {
    await turn(echo);
    expect(h.loadRecentMissionsBlock).not.toHaveBeenCalled();
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
  });

  it('a slow missions load still fails open to "" via its own deadline (the coordinator adds none and waits for it)', async () => {
    h.loadRecentMissionsBlock.mockResolvedValue('');           // recentMissions.ts resolves "" on a slow/failed read (its own 4 s cap, unchanged)
    await turn();
    const opts = h.stream.mock.calls[0][1] as { systemPrompt: string };
    expect(opts.systemPrompt).not.toContain('Recent missions');
  });

  it('the prompt text is exactly what the serial code built: base, then the missions block, then the identity directive', async () => {
    h.loadRecentMissionsBlock.mockResolvedValue('## Recent missions\n- "A" — completed');
    h.getClientProfile.mockResolvedValue({ tenantId: 'tenant-A', assistantName: 'Sara', preferredLanguage: 'ar' });
    await turn();
    const prompt = (h.stream.mock.calls[0][1] as { systemPrompt: string }).systemPrompt;
    const iMissions = prompt.indexOf('## Recent missions');
    const iPrefs = prompt.indexOf('## Client Preferences');
    expect(iMissions).toBeGreaterThan(0);
    expect(iPrefs).toBeGreaterThan(iMissions);
    expect(prompt).toContain('"Sara"');
  });
});

describe('B4 - the loaded settings are passed down, not read again', () => {
  it('route() and streamWithFallback() receive the SAME settings object; loadSettings ran once for the turn', async () => {
    await turn();
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
    expect(h.route.mock.calls[0][0].settings).toBe(SETTINGS);
    expect(h.route.mock.calls[0][0].tenantId).toBe('tenant-A');
    const opts = h.stream.mock.calls[0][1] as { settings: unknown; temperature: number; maxTokens: number };
    expect(opts.settings).toBe(SETTINGS);
    expect(opts.temperature).toBe(0.3);
    expect(opts.maxTokens).toBe(777);
  });

  it('the REAL route(): with settings supplied it never calls loadSettings; without them a second call inside the TTL still does not re-read', async () => {
    vi.resetModules();
    vi.doMock('@/lib/ai/router/modelCatalog', () => ({ getCandidateModels: vi.fn(async () => []) }));
    vi.doMock('@/lib/ai/router/healthTracker', async (orig) => ({ ...(await orig<object>()), getAllHealth: vi.fn(async () => new Map()) }));
    const { route } = await vi.importActual<typeof import('@/lib/ai/router')>('@/lib/ai/router');
    const chatReads = await import('@/lib/ai/chatReads');
    const cls = { taskType: 'FAST_CHAT', latencySensitivity: 'high', costSensitivity: 'high', complexity: 'simple', urgency: 'low', expectedContextSize: 'small', needsTools: false, needsReasoning: false, needsStructuredOutput: false, needsVision: false, reliabilityRequirement: 'normal' } as never;
    h.loadSettings.mockClear();
    await route({ classification: cls, tenantId: null, settings: SETTINGS });
    expect(h.loadSettings).not.toHaveBeenCalled();
    await route({ classification: cls, tenantId: null });
    await route({ classification: cls, tenantId: null });
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
    chatReads.settingsReadCache.clear();
    vi.doUnmock('@/lib/ai/router/modelCatalog');
    vi.doUnmock('@/lib/ai/router/healthTracker');
  });

  it('the REAL streamWithFallback(): options.settings is used and loadSettings is not called', async () => {
    vi.resetModules();
    const realFetch = globalThis.fetch;
    vi.doMock('@/lib/ai/usageLedger', () => ({ recordUsage: vi.fn(async () => {}) }));
    vi.doMock('@/lib/ai/router/healthTracker', async (orig) => ({ ...(await orig<object>()), getAllHealth: vi.fn(async () => new Map()), getHealth: vi.fn(async () => null), recordHealth: vi.fn() }));
    const enc = new TextEncoder();
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(JSON.stringify({ delta: 'hi' }) + '\n' + JSON.stringify({ done: true, usage: { inputTokens: 1, outputTokens: 1 } }) + '\n')); c.close(); } }), { status: 200 })) as never;
    try {
      const real = await vi.importActual<typeof import('@/lib/ai/ai-provider')>('@/lib/ai/ai-provider');
      h.loadSettings.mockClear();
      const text = await real.streamWithFallback([{ role: 'user', content: 'x' }], {
        settings: { ...SETTINGS, active_provider: 'groq', groq_api_key: 'k' } as never,
        candidates: [{ provider: 'groq', model: 'openai/gpt-oss-120b' }],
        usageContext: { operation: 'chat', tenantId: null },
        onDelta: () => {},
      });
      expect(text).toBe('hi');
      expect(h.loadSettings).not.toHaveBeenCalled();
      await real.flushPendingUsageRecords();
    } finally {
      globalThis.fetch = realFetch;
      vi.doUnmock('@/lib/ai/usageLedger');
      vi.doUnmock('@/lib/ai/router/healthTracker');
    }
  });
});

describe('B4 - TTL cache: expiry with an injected clock', () => {
  it('settings: one read inside the TTL, a fresh read after it', async () => {
    expect(SETTINGS_CACHE_TTL_MS).toBeLessThanOrEqual(30_000);
    await loadSettingsCached('tenant-A');
    now += SETTINGS_CACHE_TTL_MS - 1;
    await loadSettingsCached('tenant-A');
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
    now += 2;
    await loadSettingsCached('tenant-A');
    expect(h.loadSettings).toHaveBeenCalledTimes(2);
  });

  it('client profile: cached inside the TTL (a null profile too), refreshed after it, and invalidateClientProfile() drops it at once', async () => {
    expect(CLIENT_PROFILE_CACHE_TTL_MS).toBeLessThanOrEqual(30_000);
    await getClientProfileCached('tenant-A');
    await getClientProfileCached('tenant-A');
    expect(h.getClientProfile).toHaveBeenCalledTimes(1);
    invalidateClientProfile('tenant-A');
    await getClientProfileCached('tenant-A');
    expect(h.getClientProfile).toHaveBeenCalledTimes(2);
    now += CLIENT_PROFILE_CACHE_TTL_MS + 1;
    await getClientProfileCached('tenant-A');
    expect(h.getClientProfile).toHaveBeenCalledTimes(3);
  });

  it('a failed load is NOT cached: the next call reads again', async () => {
    h.loadSettings.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(SETTINGS);
    await expect(loadSettingsCached('tenant-A')).rejects.toThrow('db down');
    await expect(loadSettingsCached('tenant-A')).resolves.toBe(SETTINGS);
    expect(h.loadSettings).toHaveBeenCalledTimes(2);
  });

  it('two loads started in the same tick share ONE read', async () => {
    await Promise.all([loadSettingsCached('tenant-A'), loadSettingsCached('tenant-A'), loadSettingsCached('tenant-A')]);
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
  });

  it('saveSettings() clears every cache (a saved setting is visible to the next turn, not 20 s later)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/client', () => ({
      supabase: { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...DEFAULT_SETTINGS, temperature: 0.9 }, error: null }) }) }) }) }) },
    }));
    const { saveSettings } = await vi.importActual<typeof import('@/lib/settings/settings-service')>('@/lib/settings/settings-service');
    const ttl = await import('@/lib/utils/ttlCache');
    const cache = new ttl.TtlCache<number>(60_000);
    await cache.getOrLoad('k', async () => 1);
    expect(cache.size).toBe(1);
    await saveSettings({ temperature: 0.9 });
    expect(cache.size).toBe(0);
    vi.doUnmock('@/lib/supabase/client');
  });
});

describe('B4 - the budget gate is NOT cached beyond 10 s', () => {
  it('the TTL is at most 10 s (5 s chosen) and a read older than that is refreshed', async () => {
    expect(BUDGET_CACHE_TTL_MS).toBeLessThanOrEqual(10_000);
    h.checkBudget.mockResolvedValueOnce({ withinBudget: true, spendUsd: 1, limitUsd: 10, alertTriggered: false });
    h.checkBudget.mockResolvedValueOnce({ withinBudget: false, spendUsd: 11, limitUsd: 10, alertTriggered: true });
    const first = await checkBudgetCached('tenant-A');
    now += 4_999;
    expect(await checkBudgetCached('tenant-A')).toBe(first);                 // the two reads of ONE turn collapse into one
    expect(h.checkBudget).toHaveBeenCalledTimes(1);
    now += 11_000;
    const later = await checkBudgetCached('tenant-A');
    expect(later.withinBudget).toBe(false);                                   // an exhausted budget is seen within seconds
    expect(h.checkBudget).toHaveBeenCalledTimes(2);
  });
});

describe('B4 - the caches never leak across tenants', () => {
  it('settings: tenant B never receives the value cached for tenant A', async () => {
    h.loadSettings.mockResolvedValueOnce({ ...SETTINGS, tag: 'A' }).mockResolvedValueOnce({ ...SETTINGS, tag: 'B' });
    const a = await loadSettingsCached('tenant-A');
    const b = await loadSettingsCached('tenant-B');
    expect((a as unknown as { tag: string }).tag).toBe('A');
    expect((b as unknown as { tag: string }).tag).toBe('B');
    expect(h.loadSettings).toHaveBeenCalledTimes(2);
    expect(await loadSettingsCached('tenant-A')).toBe(a);                    // and A still gets A's own
  });

  it('client profile: each tenant gets its own profile; invalidating A leaves B cached', async () => {
    h.getClientProfile.mockImplementation(async (t: string) => ({ tenantId: t, assistantName: `name-${t}`, preferredLanguage: 'en' }));
    const a = await getClientProfileCached('tenant-A');
    const b = await getClientProfileCached('tenant-B');
    expect(a?.assistantName).toBe('name-tenant-A');
    expect(b?.assistantName).toBe('name-tenant-B');
    invalidateClientProfile('tenant-A');
    await getClientProfileCached('tenant-B');
    expect(h.getClientProfile).toHaveBeenCalledTimes(2);                      // B was not re-read
    expect(await getClientProfileCached('tenant-A')).not.toBe(a);             // A was
  });

  it('budget: one tenant\'s exhausted budget is never applied to another', async () => {
    h.checkBudget.mockImplementation(async (t: string) => ({ withinBudget: t !== 'tenant-A', spendUsd: 0, limitUsd: 1, alertTriggered: false }));
    expect((await checkBudgetCached('tenant-A')).withinBudget).toBe(false);
    expect((await checkBudgetCached('tenant-B')).withinBudget).toBe(true);
    expect(h.checkBudget).toHaveBeenCalledTimes(2);
  });

  it('a missing tenant is its own scope, never a wildcard for a real tenant', async () => {
    h.loadSettings.mockResolvedValueOnce({ ...SETTINGS, tag: 'none' }).mockResolvedValueOnce({ ...SETTINGS, tag: 'A' });
    await loadSettingsCached(null);
    const a = await loadSettingsCached('tenant-A');
    expect((a as unknown as { tag: string }).tag).toBe('A');
  });

  it('a whole coordinator turn for tenant B after tenant A passes B\'s own settings to route()', async () => {
    const settingsA = { ...SETTINGS, temperature: 0.1 };
    const settingsB = { ...SETTINGS, temperature: 0.9 };
    h.loadSettings.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB);
    h.tenant = 'tenant-A'; await turn();
    h.tenant = 'tenant-B'; await turn();
    expect(h.route.mock.calls[0][0].settings).toBe(settingsA);
    expect(h.route.mock.calls[1][0].settings).toBe(settingsB);
  });
});

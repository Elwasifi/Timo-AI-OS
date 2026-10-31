// M7-13e: route() for CLIENT (BYOK) tenants. Before this change route() asked
// app_settings which providers were "configured" — a table only the internal
// tenant can read — so every client tenant got 0 candidates and the router's
// gates never applied to them. Now the configured providers/models come from
// that tenant's own tenant_provider_keys rows (provider + model columns only).
//
// Supabase is faked at the client boundary with fixtures (no network, no DB
// writes); the router, catalog, health, scoring and gate code are all real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const INTERNAL = '00000000-0000-0000-0000-000000000001';
const CLIENT_WITH_KEYS = 'client-with-groq-gemini';
const CLIENT_NO_KEYS = 'client-without-keys';

const selects: Array<{ table: string; columns: string }> = [];
const fixtures: Record<string, unknown> = {};

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    let eqTenant: string | null = null;
    const builder: Record<string, unknown> = {
      select: (columns: string) => { selects.push({ table, columns }); return builder; },
      eq: (_col: string, value: string) => { eqTenant = value; return builder; },
      maybeSingle: async () => ({ data: (fixtures[table] as unknown) ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'tenant_provider_keys' && fixtures['__fail_keys']) {
          return Promise.resolve({ data: null, error: { message: 'permission denied for table tenant_provider_keys' } }).then(resolve);
        }
        const data = table === 'tenant_provider_keys'
          ? ((fixtures[table] as Record<string, unknown[]>)[eqTenant ?? ''] ?? [])
          : ((fixtures[table] as unknown[]) ?? []);
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { supabase: { from, rpc: vi.fn(async () => ({ data: null, error: null })) } };
});
vi.mock('@/lib/governance/entitlements', () => ({ checkBudget: vi.fn(async () => ({ withinBudget: true, spendUsd: 0, limitUsd: null, alertTriggered: false })) }));

const now = new Date().toISOString();
const catalogRow = (provider: string, model_id: string) => ({
  provider, model_id, display_name: model_id, context_length: 128000, input_price: 0.1, output_price: 0.2,
  free: false, supports_streaming: true, supports_tools: true, validated_at: now,
});
const healthRow = (provider: string, model_id: string, ok: number, fail: number, avg: number) => ({
  provider, model_id, success_count: ok, failure_count: fail, consecutive_failures: 0, avg_latency_ms: avg,
  last_success_at: now, last_failure_at: null, last_status_code: 200,
});

import { route, classifyTask } from '@/lib/ai/router';
import { invalidateTenantProviderConfig, ByokNotConfiguredError, loadTenantProviderConfig, __resetWarnStateForTesting } from '@/lib/settings/tenantConfiguredProviders';
import { chatWithFallback } from '@/lib/ai/ai-provider';
import { DEFAULT_SETTINGS } from '@/lib/settings/settings-service';

const chatRequest = (tenantId: string | null) => ({ classification: classifyTask({ text: 'Hi' }), tenantId });

beforeEach(() => {
  selects.length = 0;
  fixtures['__fail_keys'] = false;
  __resetWarnStateForTesting();
  invalidateTenantProviderConfig();
  fixtures['provider_model_catalog'] = [
    catalogRow('groq', 'openai/gpt-oss-120b'),
    catalogRow('gemini', 'gemini-3.1-flash-lite-preview'),
    catalogRow('gemini', 'gemini-3.6-flash'),          // reasoning-heavy: must stay excluded by the existing gate
    catalogRow('nvidia', 'nvidia/some-chat-model'),
    catalogRow('openrouter', 'meta-llama/llama-3.3-70b-instruct'),
  ];
  fixtures['provider_model_health'] = [
    healthRow('groq', 'openai/gpt-oss-120b', 14, 1, 1000),
    healthRow('gemini', 'gemini-3.1-flash-lite-preview', 123, 1, 4700),
    healthRow('gemini', 'gemini-3.6-flash', 40, 24, 15000),
    healthRow('nvidia', 'nvidia/some-chat-model', 5, 0, 900),
    healthRow('openrouter', 'meta-llama/llama-3.3-70b-instruct', 9, 1, 2500),
  ];
  // The INTERNAL tenant's app_settings: keys for nvidia + openrouter + groq (but NOT gemini). A client tenant must never see this.
  fixtures['app_settings'] = { ...DEFAULT_SETTINGS, routing_mode: 'automatic', groq_api_key: 'internal-groq', nvidia_api_key: 'internal-nvidia', openrouter_api_key: 'internal-or', gemini_api_key: null };
  fixtures['tenant_provider_keys'] = {
    [CLIENT_WITH_KEYS]: [{ provider: 'groq', model: null }, { provider: 'gemini', model: null }],
    [CLIENT_NO_KEYS]: [],
  };
});

describe('route() — client tenant with groq + gemini keys', () => {
  it('offers ONLY that tenant\'s providers, ignoring the internal tenant\'s app_settings keys, and keeps every gate', async () => {
    const d = await route(chatRequest(CLIENT_WITH_KEYS));
    expect(d.mode).toBe('automatic');
    expect(d.byokMissing).toBeUndefined();
    const providers = new Set(d.candidates.map((c) => c.provider));
    expect(providers).toEqual(new Set(['groq', 'gemini']));           // not nvidia / openrouter (internal-only keys)
    expect(d.candidates[0]).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' }); // proven + fastest, trusted pool
    expect(d.candidates.map((c) => c.model)).not.toContain('gemini-3.6-flash');          // interactive/reasoning gate still applies
  });

  it('reads ONLY provider + model from tenant_provider_keys — never api_key', async () => {
    await route(chatRequest(CLIENT_WITH_KEYS));
    const keySelects = selects.filter((s) => s.table === 'tenant_provider_keys');
    expect(keySelects.length).toBeGreaterThan(0);
    for (const s of keySelects) {
      expect(s.columns).toBe('provider, model');
      expect(s.columns).not.toMatch(/api_key|\*/);
    }
  });

  it('honors a pinned model for a provider', async () => {
    (fixtures['tenant_provider_keys'] as Record<string, unknown[]>)[CLIENT_WITH_KEYS] = [
      { provider: 'groq', model: null }, { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
    ];
    invalidateTenantProviderConfig();
    const d = await route(chatRequest(CLIENT_WITH_KEYS));
    expect(d.candidates.filter((c) => c.provider === 'gemini').map((c) => c.model)).toEqual(['gemini-3.1-flash-lite-preview']);
  });
});

describe('route() / chatWithFallback — client tenant with NO keys', () => {
  it('route() returns a clear BYOK decision (no candidates, byokMissing) instead of borrowing internal providers', async () => {
    const d = await route(chatRequest(CLIENT_NO_KEYS));
    expect(d.byokMissing).toBe(true);
    expect(d.candidates).toEqual([]);
    expect(d.reason).toMatch(/API key/i);
  });

  it('chatWithFallback throws ByokNotConfiguredError and never calls any provider', async () => {
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await expect(
        chatWithFallback([{ role: 'user', content: 'hi' }], { usageContext: { operation: 'chat', tenantId: CLIENT_NO_KEYS } }),
      ).rejects.toBeInstanceOf(ByokNotConfiguredError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('route() — internal tenant unchanged', () => {
  afterEach(() => invalidateTenantProviderConfig());

  for (const [label, tenantId] of [['INTERNAL_TENANT_ID', INTERNAL], ['null tenant', null]] as const) {
    it(`${label}: candidates still come from app_settings keys; tenant_provider_keys is never queried`, async () => {
      const d = await route(chatRequest(tenantId));
      const providers = new Set(d.candidates.map((c) => c.provider));
      // app_settings fixture has groq + nvidia + openrouter keys, no gemini key
      expect(providers.has('gemini')).toBe(false);
      expect(providers.has('groq')).toBe(true);
      expect(selects.some((s) => s.table === 'tenant_provider_keys')).toBe(false);
      expect(d.byokMissing).toBeUndefined();
    });
  }
});

describe('observability: a failed tenant_provider_keys read must not be silent', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); fixtures['__fail_keys'] = false; });

  it('returns null (unknown, NOT "no keys") and warns once per tenant per minute', async () => {
    fixtures['__fail_keys'] = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    for (let i = 0; i < 3; i++) expect(await loadTenantProviderConfig('tenant-x')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);                                    // 3 failures within the minute -> ONE warning
    expect(String(warn.mock.calls[0][0])).toContain('tenant-x');
    expect(String(warn.mock.calls[0][0])).toContain('permission denied');

    expect(await loadTenantProviderConfig('tenant-y')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);                                    // a different tenant warns on its own

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(await loadTenantProviderConfig('tenant-x')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);                                    // after a minute it warns again
  });

  it('a failed read does not turn into a false "no keys" BYOK error in route()', async () => {
    fixtures['__fail_keys'] = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = await route(chatRequest('tenant-z'));
    expect(d.byokMissing).toBeUndefined();
  });
});

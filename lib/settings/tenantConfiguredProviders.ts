// M7-13e: which AI providers (and pinned models) a CLIENT tenant has set up
// via BYOK (M7-09), for the Dynamic Model Router and the fallback chain.
//
// Deliberately separate from tenantProviderKeys.ts (the CRUD module that
// reads/writes the keys themselves): this module selects ONLY the
// `provider` and `model` columns — never `api_key` — so nothing routing-
// related can ever hold, log, or return a key value. Actual key resolution
// stays where it was: server-side in the ai-chat edge function.

import { supabase } from '@/lib/supabase/client';
import { INTERNAL_TENANT_ID } from '@/lib/governance/internalTenant';
import type { ProviderId } from './settings-service';

/** Whether a tenant should use BYOK at all — false only for the one grandfathered internal/admin tenant (M7-09 scoping), which keeps using app_settings. */
export function requiresByok(tenantId: string | null | undefined): boolean {
  return !!tenantId && tenantId !== INTERNAL_TENANT_ID;
}

export interface TenantProviderConfig {
  provider: ProviderId;
  /** The tenant's pinned model for this provider, or null = no preference (any catalog model). */
  model: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: TenantProviderConfig[] }>();

// A failed read returns null and routing silently falls back to its previous
// (0-candidate) behavior for that tenant — so it must never be invisible. One
// console.warn per tenant per minute: loud enough to notice, not a log flood.
const WARN_INTERVAL_MS = 60_000;
const lastWarnAt = new Map<string, number>();
function warnReadFailed(tenantId: string, reason: string): void {
  const now = Date.now();
  const last = lastWarnAt.get(tenantId);
  if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
  lastWarnAt.set(tenantId, now);
  console.warn(
    `[tenantConfiguredProviders] Could not read provider config for tenant ${tenantId} (${reason}) — routing is falling back to its default behavior for this tenant.`,
  );
}

/** Test-only: forget warn rate-limit state. */
export function __resetWarnStateForTesting(): void {
  lastWarnAt.clear();
}

/**
 * Provider names + pinned models configured for a client tenant.
 * Returns `null` when the read itself failed (callers must treat that as
 * "unknown" and fall back to their previous behavior — never as "no keys").
 * Returns `[]` only when the tenant genuinely has no keys configured.
 */
export async function loadTenantProviderConfig(tenantId: string): Promise<TenantProviderConfig[] | null> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  let data: unknown;
  try {
    const res = await supabase
      .from('tenant_provider_keys')
      .select('provider, model') // NEVER api_key — see header
      .eq('tenant_id', tenantId);
    if (res.error || !res.data) {
      warnReadFailed(tenantId, res.error?.message ?? 'no data returned');
      return null;
    }
    data = res.data;
  } catch (err) {
    warnReadFailed(tenantId, err instanceof Error ? err.message : String(err));
    return null;
  }

  const rows = (data as Array<{ provider: string; model: string | null }>).map((r) => ({
    provider: r.provider as ProviderId,
    model: r.model,
  }));
  cache.set(tenantId, { at: Date.now(), rows });
  return rows;
}

/** Drop cached config — called when a tenant adds/removes a key so routing sees it immediately. */
export function invalidateTenantProviderConfig(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Typed error for a client tenant that has no provider keys at all. Never falls back to the internal tenant's keys. */
export class ByokNotConfiguredError extends Error {
  readonly code = 'byok_not_configured';
  constructor() {
    super('No AI provider API key is configured for this workspace. Add a key under Settings → AI Providers to start chatting.');
    this.name = 'ByokNotConfiguredError';
  }
}

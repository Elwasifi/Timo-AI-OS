// M7-09 — BYOK (Bring Your Own Key): per-tenant AI provider credentials.
//
// Separate from app_settings on purpose (see docs/TEMO-ARCHITECTURE.md's
// M7-09 section) — app_settings is a singleton with no tenant_id column at
// all, now restricted to the internal/admin tenant only. Every other
// tenant's provider keys live here, one row per (tenant, provider), RLS
// via is_tenant_member(tenant_id) same as every other tenant-scoped table.
//
// Browser-safe: reads/writes go through the shared `supabase` client (the
// user's own session, RLS-enforced), the same pattern saveSettings() and
// WorkspaceSection already use in app/settings/page.tsx — no server route
// needed for plain CRUD, only the actual provider HTTP call (validate)
// needs a server hop, same as before.

import { supabase } from '@/lib/supabase/client';
import type { ProviderId } from './settings-service';
import { resetProviderCircuits } from '@/lib/ai/ai-provider';
import { requiresByok, invalidateTenantProviderConfig } from './tenantConfiguredProviders';

/** Ollama is self-hosted/local — excluded from BYOK (M7-09 scoping): a tenant's own instance isn't reachable from this server. */
export type ByokProviderId = Exclude<ProviderId, 'ollama'>;
export const BYOK_PROVIDERS: ByokProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter'];

export interface TenantProviderKey {
  tenantId: string;
  provider: ByokProviderId;
  apiKey: string;
  model: string | null;
  updatedAt: string;
}

interface TenantProviderKeyRow {
  tenant_id: string;
  provider: string;
  api_key: string;
  model: string | null;
  updated_at: string;
}

function mapRow(row: TenantProviderKeyRow): TenantProviderKey {
  return {
    tenantId: row.tenant_id,
    provider: row.provider as ByokProviderId,
    apiKey: row.api_key,
    model: row.model,
    updatedAt: row.updated_at,
  };
}

// M7-13e: requiresByok() moved to tenantConfiguredProviders.ts (the routing-side, names-only module) so lib/ai can use it without importing this key-CRUD module; re-exported here so existing importers are unchanged.
export { requiresByok };

export async function loadTenantProviderKeys(tenantId: string): Promise<TenantProviderKey[]> {
  const { data, error } = await supabase
    .from('tenant_provider_keys')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('[tenantProviderKeys] load error:', error.message);
    return [];
  }
  return ((data ?? []) as TenantProviderKeyRow[]).map(mapRow);
}

export async function saveTenantProviderKey(
  tenantId: string,
  provider: ByokProviderId,
  apiKey: string,
  model?: string | null,
): Promise<void> {
  const { error } = await supabase.from('tenant_provider_keys').upsert({
    tenant_id: tenantId,
    provider,
    api_key: apiKey,
    model: model ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save ${provider} key: ${error.message}`);
  // M7-13e: a fixed/replaced key should be retried immediately, not after the 30-minute hard-failure cooldown.
  resetProviderCircuits(tenantId, provider);
  invalidateTenantProviderConfig(tenantId); // routing sees the new provider immediately
}

export async function deleteTenantProviderKey(tenantId: string, provider: ByokProviderId): Promise<void> {
  const { error } = await supabase
    .from('tenant_provider_keys')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', provider);
  if (error) throw new Error(`Failed to remove ${provider} key: ${error.message}`);
  invalidateTenantProviderConfig(tenantId);
}

/** Which BYOK providers this tenant has configured right now. */
export async function checkTenantProviderKeys(tenantId: string): Promise<Record<ByokProviderId, boolean>> {
  const keys = await loadTenantProviderKeys(tenantId);
  const configured = new Set(keys.map((k) => k.provider));
  return {
    gemini: configured.has('gemini'),
    groq: configured.has('groq'),
    nvidia: configured.has('nvidia'),
    openrouter: configured.has('openrouter'),
  };
}

/** M7-09's onboarding gate: true once this tenant has configured at least one real provider key. */
export async function hasAnyByokConfigured(tenantId: string): Promise<boolean> {
  const configured = await checkTenantProviderKeys(tenantId);
  return Object.values(configured).some(Boolean);
}

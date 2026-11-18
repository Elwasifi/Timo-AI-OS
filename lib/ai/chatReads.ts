// M7-13c-2c-b — cached readers for the three database reads every chat turn used to repeat before the first model call:
//   app settings (read by the coordinator, route() and the fallback chain), the client profile, and the budget gate.
// They WRAP the existing uncached functions (loadSettings / getClientProfile / checkBudget stay as they are, and every other caller
// keeps using them), so nothing is duplicated and a fresh read is always one call away.
//
// TTL choices (and why):
//   settings  20 s  changes only when somebody saves them in Settings; saveSettings() clears every TtlCache.
//   profile   30 s  changes only when the owner saves it; the Settings page calls invalidateClientProfile().
//   budget     5 s  an ENFORCEMENT gate: the cache only collapses the two reads one turn makes (route() + the fallback chain's budget
//                   gate, milliseconds apart) into one. The next turn re-checks; mission launches keep the uncached checkBudget().
// Keys always carry the tenant (tenantKey()); a missing tenant is its own scope, never a wildcard. A rejected load is not cached.

import { loadSettings, type AppSettings } from '@/lib/settings/settings-service';
import { getClientProfile, type ClientProfile } from '@/lib/governance/clientProfile';
import { checkBudget } from '@/lib/governance/entitlements';
import { TtlCache, tenantKey } from '@/lib/utils/ttlCache';

export const SETTINGS_CACHE_TTL_MS = 20_000;
export const CLIENT_PROFILE_CACHE_TTL_MS = 30_000;
export const BUDGET_CACHE_TTL_MS = 5_000;

type BudgetCheck = Awaited<ReturnType<typeof checkBudget>>;

export const settingsReadCache = new TtlCache<AppSettings>(SETTINGS_CACHE_TTL_MS);
export const clientProfileReadCache = new TtlCache<ClientProfile | null>(CLIENT_PROFILE_CACHE_TTL_MS);
export const budgetReadCache = new TtlCache<BudgetCheck>(BUDGET_CACHE_TTL_MS);

/** app_settings for the chat hot path: cached 20 s per tenant scope (the row a session can see depends on who is signed in to that tenant). */
export function loadSettingsCached(tenantId: string | null | undefined): Promise<AppSettings> {
  return settingsReadCache.getOrLoad(tenantKey(tenantId), () => loadSettings());
}

/** The tenant's client profile, cached 30 s per tenant. No tenant -> null (same as getClientProfile). A null profile is cached too. */
export function getClientProfileCached(tenantId: string | null): Promise<ClientProfile | null> {
  if (!tenantId) return Promise.resolve(null);
  return clientProfileReadCache.getOrLoad(tenantKey(tenantId), () => getClientProfile(tenantId));
}

/** Call after the profile is saved so the next chat turn sees the new assistant name / language. */
export function invalidateClientProfile(tenantId: string | null | undefined): void {
  clientProfileReadCache.delete(tenantKey(tenantId));
}

/** checkBudget() for the chat hot path: cached 5 s per tenant (see the header). */
export function checkBudgetCached(tenantId: string): Promise<BudgetCheck> {
  return budgetReadCache.getOrLoad(tenantKey(tenantId), () => checkBudget(tenantId));
}

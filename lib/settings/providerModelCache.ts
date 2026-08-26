// Client-side cache for discovered provider models (Provider Validation &
// Model Discovery pass, 2026-08-20). Keeps the model dropdown populated
// with the last successful discovery immediately on page load, without
// re-hitting the provider on every render — discovery only ever runs when
// the user clicks Validate. A stale/expired cache entry is still shown
// (marked stale by the caller) rather than erased, so a temporary
// discovery failure never blanks out the user's working configuration.

import type { ModelInfo, ProviderId, ProviderValidationStatus } from './settings-service';

const TTL_MS = 24 * 60 * 60 * 1000; // 24h — models don't change hour to hour
const KEY_PREFIX = 'temo:provider-models:';

export interface CachedValidation {
  status: ProviderValidationStatus;
  message: string;
  models: ModelInfo[];
  validatedAt: number;
}

export function loadCachedValidation(provider: ProviderId): (CachedValidation & { stale: boolean }) | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + provider);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedValidation;
    if (!parsed?.validatedAt) return null;
    return { ...parsed, stale: Date.now() - parsed.validatedAt > TTL_MS };
  } catch {
    return null;
  }
}

export function saveCachedValidation(provider: ProviderId, result: Omit<CachedValidation, 'validatedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedValidation = { ...result, validatedAt: Date.now() };
    window.localStorage.setItem(KEY_PREFIX + provider, JSON.stringify(entry));
  } catch {
    // Storage full/unavailable — caching is a convenience, never fatal.
  }
}

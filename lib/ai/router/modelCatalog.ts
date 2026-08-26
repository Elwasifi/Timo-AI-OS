// Dynamic Model Router — model catalog access.
//
// Reads FROM provider_model_catalog (written by supabase/functions/ai-chat's
// action:'validate' handler — the same real listModels() discovery this
// app already performs, just persisted server-side now instead of staying
// trapped in browser localStorage). This module does not call any provider
// itself and does not duplicate discovery logic — it only reads what
// discovery already produced, plus checks which providers are actually
// configured (app_settings) to know which catalog rows are even usable.
//
// Falls back to the static PROVIDER_MODELS list (marked entirely UNKNOWN
// capability) for a provider that's configured but has never been
// validated yet — so routing still works before the user ever clicks
// "Validate Connection", just with no real capability/pricing data to
// score against.

import { supabase } from '@/lib/supabase/client';
import { loadSettings, PROVIDER_MODELS, PROVIDER_KEY_FIELD, type ProviderId, type AppSettings } from '@/lib/settings/settings-service';
import { inferModelCapabilities } from './modelCapabilities';
import type { ModelCapabilityProfile } from './types';

interface CatalogRow {
  provider: string;
  model_id: string;
  display_name: string | null;
  context_length: number | null;
  input_price: number | null;
  output_price: number | null;
  free: boolean | null;
  supports_streaming: boolean | null;
  supports_tools: boolean | null;
  validated_at: string;
}

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — matches the mission's "cached model catalog" performance requirement
let cache: { rows: CatalogRow[]; fetchedAt: number } | null = null;

async function loadCatalogRows(): Promise<CatalogRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return cache.rows;
  }
  const { data, error } = await supabase
    .from('provider_model_catalog')
    .select('provider, model_id, display_name, context_length, input_price, output_price, free, supports_streaming, supports_tools, validated_at');
  if (error) {
    // Table may not exist yet if the router-foundation migration hasn't
    // been applied — degrade to the static fallback rather than throwing,
    // consistent with this codebase's "never let a routing decision block
    // the app" posture.
    return cache?.rows ?? [];
  }
  cache = { rows: (data ?? []) as CatalogRow[], fetchedAt: Date.now() };
  return cache.rows;
}

const VALIDATED_STALE_MS = 24 * 60 * 60 * 1000; // matches lib/settings/providerModelCache.ts's TTL

function isProviderId(id: string): id is ProviderId {
  return id === 'gemini' || id === 'groq' || id === 'nvidia' || id === 'openrouter' || id === 'ollama';
}

function providerConfigured(provider: ProviderId, settings: AppSettings): boolean {
  if (provider === 'ollama') return !!settings.ollama_base_url;
  const field = PROVIDER_KEY_FIELD[provider];
  return !!settings[field];
}

/**
 * The full set of candidate models for routing: real discovered catalog
 * rows for providers that have been validated, plus a static-fallback
 * entry (all capabilities unknown) for configured-but-never-validated
 * providers, so routing degrades gracefully rather than having zero
 * candidates. Providers with no key/URL configured at all are excluded
 * entirely — never appear as a routable candidate.
 */
export async function getCandidateModels(): Promise<ModelCapabilityProfile[]> {
  const [rows, settings] = await Promise.all([loadCatalogRows(), loadSettings()]);
  const profiles: ModelCapabilityProfile[] = [];
  const seenProviders = new Set<string>();

  for (const row of rows) {
    if (!isProviderId(row.provider)) continue;
    if (!providerConfigured(row.provider, settings)) continue;
    seenProviders.add(row.provider);
    const validatedAt = new Date(row.validated_at).getTime();
    const stale = Date.now() - validatedAt > VALIDATED_STALE_MS;
    profiles.push({
      provider: row.provider,
      modelId: row.model_id,
      displayName: row.display_name ?? undefined,
      available: true,
      validationStatus: stale ? 'stale' : 'connected',
      lastValidatedAt: row.validated_at,
      free: row.free === null ? 'unknown' : row.free,
      inputPrice: row.input_price,
      outputPrice: row.output_price,
      contextLength: row.context_length,
      supportsStreaming: row.supports_streaming === null ? 'unknown' : row.supports_streaming,
      supportsTools: row.supports_tools === null ? 'unknown' : row.supports_tools,
      supportsStructuredOutput: 'unknown',
      supportsVision: 'unknown',
      supportsAudio: 'unknown',
      multilingual: 'unknown',
      ...inferModelCapabilities(row.provider, row.model_id),
    });
  }

  // Configured providers with no discovery rows yet at all — fall back to
  // the static preset list so they're still routable, fully unknown.
  const providerIds: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];
  for (const pid of providerIds) {
    if (seenProviders.has(pid)) continue;
    if (!providerConfigured(pid, settings)) continue;
    for (const modelId of PROVIDER_MODELS[pid]) {
      profiles.push({
        provider: pid,
        modelId,
        available: true,
        validationStatus: 'never_validated',
        lastValidatedAt: null,
        free: 'unknown',
        inputPrice: null,
        outputPrice: null,
        contextLength: null,
        supportsStreaming: 'unknown',
        supportsTools: 'unknown',
        supportsStructuredOutput: 'unknown',
        supportsVision: 'unknown',
        supportsAudio: 'unknown',
        multilingual: 'unknown',
        ...inferModelCapabilities(pid, modelId),
      });
    }
  }

  return profiles;
}

export function invalidateCatalogCache(): void {
  cache = null;
}

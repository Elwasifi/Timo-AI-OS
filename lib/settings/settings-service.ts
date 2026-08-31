import { supabase } from '@/lib/supabase/client';

/**
 * AppSettings — the single source of truth for all AI provider configuration.
 *
 * OpenAI and Anthropic have been removed from the development stack. The
 * legacy openai and anthropic columns remain in the database (kept for data
 * safety) but are no longer referenced here.
 */
export interface AppSettings {
  id: number;
  // Active provider + generation params
  active_provider: string;
  temperature: number;
  max_tokens: number;
  // Google Gemini
  gemini_api_key: string | null;
  gemini_model: string;
  // Groq
  groq_api_key: string | null;
  groq_model: string;
  // NVIDIA Build / NIM
  nvidia_api_key: string | null;
  nvidia_model: string;
  // OpenRouter
  openrouter_api_key: string | null;
  openrouter_model: string;
  // Ollama (local, configurable base URL — NOT hardcoded)
  ollama_base_url: string | null;
  ollama_api_key: string | null;
  ollama_model: string;
  // n8n integration (server-side proxy; API key never exposed to frontend)
  n8n_url: string | null;
  n8n_api_key: string | null;
  n8n_timeout: number;
  n8n_retry_count: number;
  n8n_ssl_verify: boolean;
  n8n_connection_status: string | null;
  // Dynamic Model Router (see lib/ai/router)
  routing_mode: RoutingMode;
  routing_strategy: RoutingStrategy;
  /** Per-task-type manual overrides, e.g. { voice: { provider: 'gemini', model: 'gemini-2.5-flash' } }. Empty = fully automatic. */
  routing_preferences: Record<string, { provider?: ProviderId; model?: string }>;
}

export type ProviderId = 'gemini' | 'groq' | 'nvidia' | 'openrouter' | 'ollama';

export type RoutingMode = 'automatic' | 'manual';
export type RoutingStrategy = 'balanced' | 'speed' | 'quality' | 'cost' | 'free_only';

/** Real, provider-reported model metadata from Settings' "Validate Connection" — never fabricated. Mirrors supabase/functions/ai-chat/types.ts's ModelInfo. */
export interface ModelInfo {
  id: string;
  displayName?: string;
  contextLength?: number;
  inputPrice?: number | null;
  outputPrice?: number | null;
  free?: boolean | null;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
}

export type ProviderValidationStatus =
  | 'connected'
  | 'not_configured'
  | 'invalid_api_key'
  | 'unauthorized'
  | 'unsupported'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'configuration_error'
  | 'unknown_error';

export interface ProviderValidationResult {
  status: ProviderValidationStatus;
  message: string;
  models?: ModelInfo[];
}

/** Fallback priority: Gemini → Groq → NVIDIA → OpenRouter → Ollama */
export const FALLBACK_ORDER: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  active_provider: 'gemini',
  temperature: 0.7,
  max_tokens: 2048,
  gemini_api_key: null,
  // M6-02 side-check: gemini-2.0-flash is confirmed dead (live 404: "no
  // longer available") — this was the DEFAULT_SETTINGS fallback used
  // whenever loadSettings()'s DB read fails, meaning a DB outage would
  // silently steer real chat calls at a 404ing model with no visible
  // signal, the same silent-failure class as M6-01.
  gemini_model: 'gemini-3.6-flash',
  groq_api_key: null,
  groq_model: 'llama-3.3-70b-versatile',
  nvidia_api_key: null,
  nvidia_model: 'meta/llama-3.1-405b-instruct',
  openrouter_api_key: null,
  // M6-02 side-check: google/gemini-2.0-flash-001 is confirmed dead on
  // OpenRouter too (live 404: "No endpoints found") — not just Google's
  // direct API. google/gemini-3.6-flash confirmed to resolve (a real
  // model-not-found 404 became a 402 insufficient-credits response,
  // which only happens once the model itself is recognized).
  openrouter_model: 'google/gemini-3.6-flash',
  ollama_base_url: null,
  ollama_api_key: null,
  ollama_model: 'llama3',
  n8n_url: null,
  n8n_api_key: null,
  n8n_timeout: 30000,
  n8n_retry_count: 3,
  n8n_ssl_verify: true,
  n8n_connection_status: null,
  routing_mode: 'automatic',
  routing_strategy: 'balanced',
  routing_preferences: {},
};

export const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  // M6-02 side-check: every other entry previously listed here is
  // confirmed dead on this project's key (live 404 on all 6, including
  // gemini-2.5-flash/-pro, which Google's own listModels() misleadingly
  // still lists as available). gemini-3.6-flash is the only model
  // confirmed to actually respond.
  gemini: ['gemini-3.6-flash'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  nvidia: ['meta/llama-3.1-405b-instruct', 'meta/llama-3.1-70b-instruct', 'meta/llama-3.1-8b-instruct', 'mistralai/mixtral-8x22b-instruct-v0.1', 'nvidia/llama-3.1-nemotron-70b-instruct'],
  // M6-02 side-check: google/gemini-2.0-flash-001 and google/gemini-flash-1.5
  // both confirmed dead on OpenRouter's catalog (404/not found live) — only
  // the Gemini entries were in scope for this check, the OpenAI/Anthropic/
  // Llama/Groq ones here are unverified, not touched.
  openrouter: ['google/gemini-3.6-flash', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct', 'groq/llama-3.3-70b-versatile'],
  ollama: ['llama3', 'llama3.1', 'mistral', 'phi3', 'qwen2.5', 'gemma2'],
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  nvidia: 'NVIDIA NIM',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (Local)',
};

/** Maps a ProviderId to its API key field on AppSettings. */
export const PROVIDER_KEY_FIELD: Record<ProviderId, keyof AppSettings> = {
  gemini: 'gemini_api_key',
  groq: 'groq_api_key',
  nvidia: 'nvidia_api_key',
  openrouter: 'openrouter_api_key',
  // Ollama auth is optional; uses ollama_api_key when set.
  ollama: 'ollama_api_key',
};

/** Maps a ProviderId to its model field on AppSettings. */
export const PROVIDER_MODEL_FIELD: Record<ProviderId, keyof AppSettings> = {
  gemini: 'gemini_model',
  groq: 'groq_model',
  nvidia: 'nvidia_model',
  openrouter: 'openrouter_model',
  ollama: 'ollama_model',
};

export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[settings] load error:', error.message);
    return DEFAULT_SETTINGS;
  }
  return data ?? DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single();

  if (error) {
    console.error('[settings] save error:', error.message);
    throw new Error(`Failed to save settings: ${error.message}`);
  }
  return data;
}

/**
 * Check whether each provider has the configuration it needs to run.
 * Ollama is considered "configured" when a base URL is set (key optional).
 */
export async function checkProviderKeys(): Promise<Record<ProviderId, boolean>> {
  const settings = await loadSettings();
  return {
    gemini: !!settings.gemini_api_key,
    groq: !!settings.groq_api_key,
    nvidia: !!settings.nvidia_api_key,
    openrouter: !!settings.openrouter_api_key,
    ollama: !!settings.ollama_base_url,
  };
}

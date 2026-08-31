// OpenRouter adapter — OpenAI-compatible, pinned to the canonical base URL.
// Per the project requirement, OpenRouter MUST always use
// https://openrouter.ai/api/v1 — this is enforced as a constant, not derived
// from user config, so it can never drift.

import { createOpenAICompat } from './openai-compat.ts';
import type { ModelInfo } from '../types.ts';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter's /models catalog is the richest of the 4 remote providers —
// it's the only one that returns real per-model pricing (as USD-per-token
// strings) alongside context length and modality info. Parsed here rather
// than in the generic OpenAI-compat fallback so Groq/NVIDIA (which don't
// expose pricing via this endpoint) never get a fabricated price.
function parseOpenRouterModel(raw: Record<string, unknown>): ModelInfo {
  const pricing = raw.pricing as { prompt?: string; completion?: string } | undefined;
  const promptPerToken = pricing?.prompt ? Number(pricing.prompt) : null;
  const completionPerToken = pricing?.completion ? Number(pricing.completion) : null;
  const inputPrice = promptPerToken !== null && !Number.isNaN(promptPerToken) ? promptPerToken * 1_000_000 : null;
  const outputPrice = completionPerToken !== null && !Number.isNaN(completionPerToken) ? completionPerToken * 1_000_000 : null;
  return {
    id: String(raw.id ?? ''),
    displayName: typeof raw.name === 'string' ? raw.name : undefined,
    contextLength: typeof raw.context_length === 'number' ? raw.context_length : undefined,
    inputPrice,
    outputPrice,
    free: inputPrice !== null && outputPrice !== null ? inputPrice === 0 && outputPrice === 0 : null,
    supportsStreaming: true,
  };
}

export const openrouterAdapter = createOpenAICompat({
  id: 'openrouter',
  label: 'OpenRouter',
  // M6-02 side-check: google/gemini-2.0-flash-001 confirmed dead live
  // (404 "No endpoints found"); google/gemini-flash-1.5 confirmed absent
  // from OpenRouter's own /models catalog. google/gemini-3.6-flash
  // confirmed to resolve (a real model-not-found 404 became a 402
  // insufficient-credits response instead, which only happens once the
  // model itself is recognized).
  defaultModel: 'google/gemini-3.6-flash',
  models: [
    'google/gemini-3.6-flash',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'meta-llama/llama-3.3-70b-instruct',
    'groq/llama-3.3-70b-versatile',
  ],
  baseUrl: OPENROUTER_BASE_URL,
  extraHeaders: {
    'HTTP-Referer': 'https://temo.ai',
    'X-Title': 'Temo AI OS',
  },
  retry: { maxRetries: 2, baseDelayMs: 1000, retryableStatuses: [429, 500, 502, 503, 504] },
  parseModelInfo: parseOpenRouterModel,
});

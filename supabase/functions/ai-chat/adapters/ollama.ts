// Ollama adapter — local, configurable. The base URL is NOT hardcoded to
// localhost; it is read from app_settings.ollama_base_url at request time and
// passed in via baseUrl. An API key is optional (only if the Ollama instance
// sits behind an auth proxy).

import { createOpenAICompat } from './openai-compat.ts';
import type { AIProviderAdapter, ModelInfo } from '../types.ts';
import { fetchWithTimeout, UpstreamError, VALIDATE_TIMEOUT_MS } from '../http.ts';

const openAICompatBase = createOpenAICompat({
  id: 'ollama',
  label: 'Ollama (Local)',
  defaultModel: 'llama3',
  models: ['llama3', 'llama3.1', 'mistral', 'phi3', 'qwen2.5', 'gemma2'],
  // No fixed baseUrl — resolved from app_settings.ollama_base_url at runtime.
  retry: { maxRetries: 1, baseDelayMs: 500, retryableStatuses: [500, 502, 503, 504] },
  requiresKey: false,
});

function isLocalHost(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

/**
 * Local Ollama (http://localhost:11434) speaks its own native API, not the
 * OpenAI-compat shape the chat path uses — /api/tags lists locally-pulled
 * models with real size/family/quantization metadata and no pricing concept
 * (it's local inference, genuinely free, not a guess). A non-local baseUrl
 * is assumed to be Ollama's cloud offering, which IS documented as
 * OpenAI-compatible, so that case reuses the shared /models path — with a
 * clear "unsupported" result rather than a crash if that assumption doesn't
 * hold for a given deployment.
 */
async function listOllamaModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]> {
  const base = (baseUrl || 'http://localhost:11434/api').replace(/\/$/, '');

  if (isLocalHost(base)) {
    // Native root is one level up from the OpenAI-compat-style base
    // (…/api) that the chat path uses.
    const tagsUrl = base.endsWith('/api') ? `${base}/tags` : `${base}/api/tags`;
    const res = await fetchWithTimeout(tagsUrl, { method: 'GET' }, 'Ollama (Local)', VALIDATE_TIMEOUT_MS);
    if (!res.ok) {
      const errText = await res.text();
      throw new UpstreamError(`Ollama list models error (${res.status}): ${errText}`, res.status);
    }
    const data = await res.json() as {
      models?: { name?: string; model?: string; details?: { parameter_size?: string; family?: string } }[];
    };
    return (data.models ?? [])
      .map((m) => ({
        id: m.model ?? m.name ?? '',
        displayName: m.details?.family && m.details?.parameter_size
          ? `${m.details.family} ${m.details.parameter_size}`
          : undefined,
        inputPrice: 0,
        outputPrice: 0,
        free: true, // local inference — a structural fact, not a guess
        supportsStreaming: true,
      }))
      .filter((m) => m.id);
  }

  return openAICompatBase.listModels(apiKey, base);
}

export const ollamaAdapter: AIProviderAdapter = {
  ...openAICompatBase,
  listModels: listOllamaModels,
};

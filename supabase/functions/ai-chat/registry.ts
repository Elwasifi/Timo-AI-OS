// Provider Adapter Registry — the single dispatch table. Adding or removing
// a provider means editing this map and its adapter file, nothing else.
// OpenAI and Anthropic are intentionally absent from the development stack.

import type { AIProviderAdapter, ProviderId } from './types.ts';
import { geminiAdapter } from './adapters/gemini.ts';
import { groqAdapter } from './adapters/groq.ts';
import { nvidiaAdapter } from './adapters/nvidia.ts';
import { openrouterAdapter } from './adapters/openrouter.ts';
import { ollamaAdapter } from './adapters/ollama.ts';

export const REGISTRY: Record<ProviderId, AIProviderAdapter> = {
  gemini: geminiAdapter,
  groq: groqAdapter,
  nvidia: nvidiaAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
};

export const PROVIDER_IDS: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];

// M7-12: kept in sync with lib/settings/settings-service.ts's FALLBACK_ORDER
// for consistency, though this copy is currently unused at runtime —
// the edge function processes whichever provider the client's request
// body names; it doesn't do its own fallback walk (that logic lives
// entirely client-side in lib/ai/ai-provider.ts).
export const FALLBACK_ORDER: ProviderId[] = ['groq', 'gemini', 'nvidia', 'openrouter', 'ollama'];

export function getAdapter(id: string): AIProviderAdapter | null {
  return REGISTRY[id as ProviderId] ?? null;
}

export function isProviderId(value: string): value is ProviderId {
  return value in REGISTRY;
}

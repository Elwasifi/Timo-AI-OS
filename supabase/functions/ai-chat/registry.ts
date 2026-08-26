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

export const FALLBACK_ORDER: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];

export function getAdapter(id: string): AIProviderAdapter | null {
  return REGISTRY[id as ProviderId] ?? null;
}

export function isProviderId(value: string): value is ProviderId {
  return value in REGISTRY;
}

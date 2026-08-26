// Groq adapter — OpenAI-compatible Chat Completions API.

import { createOpenAICompat } from './openai-compat.ts';

export const groqAdapter = createOpenAICompat({
  id: 'groq',
  label: 'Groq',
  defaultModel: 'llama-3.3-70b-versatile',
  models: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama-3.1-70b-versatile',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  baseUrl: 'https://api.groq.com/openai/v1',
  retry: { maxRetries: 2, baseDelayMs: 800, retryableStatuses: [429, 500, 502, 503, 504] },
});

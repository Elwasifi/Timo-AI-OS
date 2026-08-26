// NVIDIA Build / NIM adapter — OpenAI-compatible Chat Completions API.

import { createOpenAICompat } from './openai-compat.ts';

export const nvidiaAdapter = createOpenAICompat({
  id: 'nvidia',
  label: 'NVIDIA NIM',
  defaultModel: 'meta/llama-3.1-405b-instruct',
  models: [
    'meta/llama-3.1-405b-instruct',
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
    'mistralai/mixtral-8x22b-instruct-v0.1',
    'nvidia/llama-3.1-nemotron-70b-instruct',
  ],
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  retry: { maxRetries: 2, baseDelayMs: 1000, retryableStatuses: [429, 500, 502, 503, 504] },
});

// Google AI Studio (Gemini) adapter.
// Gemini is NOT OpenAI-compatible: it uses a /models/{model}:generateContent
// path, an API key in the query string, a contents/parts body shape, and a
// different SSE event format. It owns all of those concerns here.

import type { AIProviderAdapter, ChatContext, ChatResult, ModelInfo } from '../types.ts';
import { fetchWithTimeout, UpstreamError, VALIDATE_TIMEOUT_MS } from '../http.ts';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const geminiAdapter: AIProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  // M6-02 side-check: every model previously listed here — gemini-2.0-flash,
  // gemini-2.0-flash-lite, gemini-1.5-flash, gemini-1.5-pro,
  // gemini-2.5-flash, gemini-2.5-pro — is confirmed dead on this project's
  // key (live-tested all 6, every one 404s: "no longer available[/to new
  // users]"). Silently 404ing and falling through the fallback chain with
  // nothing surfacing it is the same silent-failure class as M6-01.
  // gemini-3.6-flash (already app_settings's configured default) is the
  // only model confirmed to actually respond on this account.
  defaultModel: 'gemini-3.6-flash',
  models: [
    'gemini-3.6-flash',
  ],
  supportsTools: true,
  requiresKey: true,
  retry: { maxRetries: 2, baseDelayMs: 1000, retryableStatuses: [429, 500, 502, 503, 504] },

  resolveUrl({ model, stream, apiKey }) {
    const op = stream ? 'streamGenerateContent' : 'generateContent';
    const qs = stream ? `?alt=sse&key=${apiKey}` : `?key=${apiKey}`;
    return `${GEMINI_BASE}/models/${model}:${op}${qs}`;
  },

  buildHeaders() {
    return { 'Content-Type': 'application/json' };
  },

  buildPayload(ctx: ChatContext): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      contents: ctx.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: ctx.temperature,
        maxOutputTokens: ctx.maxTokens,
      },
    };
    if (ctx.systemPrompt) {
      payload['systemInstruction'] = { parts: [{ text: ctx.systemPrompt }] };
    }
    // Gemini tool calling uses a different schema; shape if provided.
    if (ctx.tools && ctx.tools.length > 0) {
      payload['tools'] = [{ functionDeclarations: ctx.tools.map((t) => t.function) }];
    }
    return payload;
  },

  parseChatResponse(data: unknown): ChatResult {
    const d = data as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const parts = d?.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p?.text ?? '').join('');
    const usage = d?.usageMetadata ?? {};
    return {
      content,
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
      },
    };
  },

  parseStreamChunk(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) return null;
    const json = trimmed.slice(6);
    if (json === '[DONE]') return null;
    try {
      const data = JSON.parse(json) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p?.text ?? '').join('');
      return text || null;
    } catch {
      return null;
    }
  },

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    // Google's real ListModels endpoint — also serves as key validation
    // (an invalid key fails this exact call with a real 401/403/400).
    const res = await fetchWithTimeout(
      `${GEMINI_BASE}/models?key=${apiKey}`,
      { method: 'GET' },
      'Google Gemini',
      VALIDATE_TIMEOUT_MS,
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new UpstreamError(`Gemini list models error (${res.status}): ${errText}`, res.status);
    }
    const data = await res.json() as {
      models?: {
        name?: string;
        displayName?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }[];
    };
    // Gemini's API doesn't expose per-model pricing — never guessed here.
    // Note: the live API no longer lists "streamGenerateContent" as a
    // separate declared method (confirmed 2026-08-20 against the real
    // endpoint) — streaming is available for any model that supports
    // generateContent, consistent with this app's own working streaming
    // chat path, so supportsStreaming mirrors that rather than looking for
    // a capability entry the API doesn't emit anymore.
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: (m.name ?? '').replace(/^models\//, ''),
        displayName: m.displayName,
        contextLength: m.inputTokenLimit,
        inputPrice: null,
        outputPrice: null,
        free: null,
        supportsStreaming: true,
        supportsTools: true,
      }))
      .filter((m) => m.id);
  },
};

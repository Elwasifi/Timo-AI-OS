// Shared factory for OpenAI-compatible providers (Groq, NVIDIA, OpenRouter,
// Ollama). They all speak the /chat/completions contract; only the base URL,
// auth header, and optional extra headers differ. Centralizing the common
// logic here removes the duplicated copies that previously lived in index.ts
// and makes each provider adapter a thin, self-describing module.

import type { AIProviderAdapter, ChatContext, ChatResult, ModelInfo, ProviderId } from '../types.ts';
import { fetchWithTimeout, UpstreamError, VALIDATE_TIMEOUT_MS } from '../http.ts';

interface OpenAICompatOptions {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  /** Fixed base URL (Groq, NVIDIA, OpenRouter) or undefined to use a configurable baseUrl. */
  baseUrl?: string;
  /** Extra headers beyond Content-Type + Authorization (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>;
  /** Whether an API key is required (Ollama may run without one). */
  requiresKey?: boolean;
  retry: AIProviderAdapter['retry'];
  supportsTools?: boolean;
  /**
   * Override how one raw /models catalog entry is turned into ModelInfo.
   * Only OpenRouter's catalog carries real pricing today; other
   * OpenAI-compatible providers get the generic fallback (id + whatever
   * context-length field they happen to expose), never fabricated pricing.
   */
  parseModelInfo?: (raw: Record<string, unknown>) => ModelInfo;
  /** Override the models-list path (default '/models'). */
  modelsPath?: string;
}

function defaultParseModelInfo(raw: Record<string, unknown>): ModelInfo {
  const contextLength =
    (raw.context_window as number | undefined) ??
    (raw.context_length as number | undefined);
  return {
    id: String(raw.id ?? ''),
    contextLength,
    inputPrice: null,
    outputPrice: null,
    free: null,
    supportsStreaming: true,
  };
}

function joinContent(parts: unknown): string {
  if (typeof parts === 'string') return parts;
  if (Array.isArray(parts)) {
    return parts.map((p: { text?: string }) => p?.text ?? '').join('');
  }
  return '';
}

export function createOpenAICompat(opts: OpenAICompatOptions): AIProviderAdapter {
  const requiresKey = opts.requiresKey ?? true;
  const supportsTools = opts.supportsTools ?? true;

  function effectiveBaseUrl(baseUrl?: string): string {
    return (baseUrl ?? opts.baseUrl ?? '').replace(/\/$/, '');
  }

  return {
    id: opts.id,
    label: opts.label,
    defaultModel: opts.defaultModel,
    models: opts.models,
    supportsTools,
    retry: opts.retry,
    requiresKey,

    resolveUrl({ stream, apiKey, baseUrl }) {
      const base = effectiveBaseUrl(baseUrl);
      const endpoint = stream ? '/chat/completions' : '/chat/completions';
      void apiKey;
      return `${base}${endpoint}`;
    },

    buildHeaders(apiKey, baseUrl) {
      void baseUrl;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);
      return headers;
    },

    buildPayload(ctx: ChatContext): Record<string, unknown> {
      const messages = [
        ...(ctx.systemPrompt ? [{ role: 'system' as const, content: ctx.systemPrompt }] : []),
        ...ctx.messages,
      ];
      const payload: Record<string, unknown> = {
        model: ctx.model,
        messages,
        temperature: ctx.temperature,
        max_tokens: ctx.maxTokens,
      };
      if (ctx.stream) payload['stream'] = true;
      if (ctx.tools && ctx.tools.length > 0 && supportsTools) {
        payload['tools'] = ctx.tools;
      }
      return payload;
    },

    parseChatResponse(data: unknown): ChatResult {
      const d = data as {
        choices?: { message?: { content?: string | { text?: string }[] | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = joinContent(d?.choices?.[0]?.message?.content ?? '');
      const usage = d?.usage ?? {};
      return {
        content,
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
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
          choices?: { delta?: { content?: string | null } }[];
        };
        return data?.choices?.[0]?.delta?.content ?? null;
      } catch {
        return null;
      }
    },

    async listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]> {
      // The OpenAI-compatible /models endpoint — also serves as key
      // validation, same as every other adapter's listModels().
      const base = effectiveBaseUrl(baseUrl);
      const path = opts.modelsPath ?? '/models';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);

      const res = await fetchWithTimeout(`${base}${path}`, { method: 'GET', headers }, opts.label, VALIDATE_TIMEOUT_MS);
      if (!res.ok) {
        const errText = await res.text();
        throw new UpstreamError(`${opts.label} list models error (${res.status}): ${errText}`, res.status);
      }
      const data = await res.json() as { data?: Record<string, unknown>[] };
      const parse = opts.parseModelInfo ?? defaultParseModelInfo;
      return (data.data ?? []).map(parse).filter((m) => m.id);
    },
  };
}

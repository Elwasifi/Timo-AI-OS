import type { ProviderId } from '@/lib/settings/settings-service';
import { FALLBACK_ORDER, loadSettings, PROVIDER_KEY_FIELD, PROVIDER_MODEL_FIELD, type AppSettings } from '@/lib/settings/settings-service';
import { logger } from '@/lib/utils/logger';
import { recordUsage, type UsageContext } from './usageLedger';
import { recordHealth } from './router/healthTracker';
import { checkBudget } from '@/lib/governance/entitlements';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /** Optional attribution for the Usage Ledger (Sprint 3). Nullable/omittable — simple chat calls need not set this. */
  usageContext?: UsageContext;
  /**
   * Ordered provider+model candidates from the Dynamic Model Router
   * (lib/ai/router). When supplied, this list REPLACES the default
   * activeProvider-then-FALLBACK_ORDER walk below — each entry is tried in
   * order with its own specific model, instead of always using whatever
   * app_settings has configured for that provider. Omit to preserve
   * today's exact behavior unchanged (no caller is required to use the
   * router).
   */
  candidates?: { provider: ProviderId; model: string }[];
}

export interface ChatResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  provider: ProviderId;
  /** The model actually used for this completion. */
  model: string;
}

export type StreamCallback = (delta: string, full: string) => void;

export interface StreamResult {
  content: string;
  /** Streaming usage is a char/4 estimate (no per-chunk token counts from providers) — see supabase/functions/ai-chat/index.ts's estimateUsage(). */
  usage: { inputTokens: number; outputTokens: number };
  provider: ProviderId;
  model: string;
}

interface AIProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  chatStream(messages: ChatMessage[], options: ChatOptions & { onDelta: StreamCallback }): Promise<StreamResult>;
  id: ProviderId;
  hasKey: boolean;
}

const EDGE_FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ai-chat`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANON_KEY}`,
    'apikey': ANON_KEY,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * AIProviderImpl — proxies requests through the ai-chat edge function, which
 * owns the provider adapter registry and reads keys from app_settings (the
 * single source of truth). Each provider's retry policy lives in the edge
 * function's adapter; this client layer applies a light retry for transient
 * transport errors and surfaces 401s so the fallback layer can skip to the
 * next provider.
 */
class AIProviderImpl implements AIProvider {
  hasKey = false;
  constructor(public readonly id: ProviderId) {}

  async refreshKeyStatus(): Promise<void> {
    const settings = await loadSettings();
    const keyField = PROVIDER_KEY_FIELD[this.id] as keyof typeof settings;
    this.hasKey = !!settings[keyField];
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const body = {
          provider: this.id,
          messages,
          systemPrompt: options.systemPrompt,
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? 2048,
          model: options.model,
          stream: false,
        };

        logger.aiDebug(`${this.id} chat attempt ${attempt + 1}/3`);

        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
          // M2-02: this specific 429 comes from the edge function's own
          // IP-level rate limit (checked before any provider is even
          // selected), not a provider being individually rate-limited —
          // retrying this provider, or falling back to the next one, would
          // just hit the identical block. Fail fast instead.
          if (err.code === 'rate_limited') {
            throw new AIProviderError(err.error, res.status, this.id, 'rate_limited');
          }
          if (isRetryable(res.status) && attempt < 2) {
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          throw new AIProviderError(err.error ?? `${this.id} failed (${res.status})`, res.status, this.id);
        }

        const data = await res.json();
        if (data.error) throw new AIProviderError(data.error, 500, this.id);

        logger.ai(`${this.id} chat succeeded`, { tokens: data.usage });
        return {
          content: data.content,
          usage: data.usage ?? { inputTokens: 0, outputTokens: 0 },
          provider: this.id,
          model: typeof data.model === 'string' && data.model ? data.model : (options.model || ''),
        };
      } catch (err) {
        if (err instanceof AIProviderError) throw err;
        if (attempt < 2) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw new AIProviderError(err instanceof Error ? err.message : 'Network error', 0, this.id);
      }
    }
    throw new AIProviderError('Exhausted retries', 500, this.id);
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions & { onDelta: StreamCallback }
  ): Promise<StreamResult> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const body = {
          provider: this.id,
          messages,
          systemPrompt: options.systemPrompt,
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? 2048,
          model: options.model,
          stream: true,
        };

        logger.aiDebug(`${this.id} stream attempt ${attempt + 1}/3`);

        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `Stream failed (${res.status})` }));
          if (err.code === 'rate_limited') {
            throw new AIProviderError(err.error, res.status, this.id, 'rate_limited');
          }
          if (isRetryable(res.status) && attempt < 2) {
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          throw new AIProviderError(err.error ?? `${this.id} stream failed (${res.status})`, res.status, this.id);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';
        let usage = { inputTokens: 0, outputTokens: 0 };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const data = JSON.parse(trimmed);
              if (data.error) throw new AIProviderError(data.error, 500, this.id);
              if (data.delta) {
                full += data.delta;
                options.onDelta(data.delta, full);
              }
              if (data.done && data.usage) {
                usage = data.usage;
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }

        logger.ai(`${this.id} stream succeeded`, { length: full.length });
        return {
          content: full,
          usage,
          provider: this.id,
          model: options.model || '',
        };
      } catch (err) {
        if (err instanceof AIProviderError && (err.code === 'rate_limited' || (!isRetryable(err.status) && err.status !== 0))) {
          throw err;
        }
        if (attempt < 2) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw err instanceof AIProviderError
          ? err
          : new AIProviderError(err instanceof Error ? err.message : 'Stream failed', 0, this.id);
      }
    }
    throw new AIProviderError('Exhausted retries', 500, this.id);
  }
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public providerId: ProviderId,
    /** Set to 'rate_limited' for the edge function's own IP-level gate (M2-02) — distinct from a provider's own transient errors. */
    public code?: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

const providers: Record<ProviderId, AIProviderImpl> = {
  gemini: new AIProviderImpl('gemini'),
  groq: new AIProviderImpl('groq'),
  nvidia: new AIProviderImpl('nvidia'),
  openrouter: new AIProviderImpl('openrouter'),
  ollama: new AIProviderImpl('ollama'),
};

export function getProvider(id: ProviderId): AIProvider {
  return providers[id] ?? providers.gemini;
}

/**
 * Determine which providers have configuration, in fallback order.
 * Ollama counts as available when a base URL is configured (key optional).
 */
async function getAvailableProviders(): Promise<ProviderId[]> {
  const settings = await loadSettings();
  const keyField = (id: ProviderId) => PROVIDER_KEY_FIELD[id] as keyof typeof settings;
  const keyMap: Record<ProviderId, boolean> = {
    gemini: !!settings[keyField('gemini')],
    groq: !!settings[keyField('groq')],
    nvidia: !!settings[keyField('nvidia')],
    openrouter: !!settings[keyField('openrouter')],
    ollama: !!settings.ollama_base_url,
  };
  const available = FALLBACK_ORDER.filter((id) => keyMap[id]);
  available.forEach((id) => { providers[id].hasKey = true; });
  return available.length > 0 ? available : FALLBACK_ORDER;
}

/**
 * Resolves the ordered (provider, model) pairs to try. When the caller
 * supplies router candidates (lib/ai/router), those are used verbatim —
 * each provider tried with the SPECIFIC model the router picked, not
 * whatever app_settings has configured for it. Otherwise, preserves
 * today's exact behavior: activeProvider first, then FALLBACK_ORDER,
 * each with its app_settings-configured model.
 */
async function resolveOrderedPairs(
  options: ChatOptions,
  settings: AppSettings,
): Promise<{ providerId: ProviderId; model: string }[]> {
  if (options.candidates && options.candidates.length > 0) {
    return options.candidates.map((c) => ({ providerId: c.provider, model: c.model }));
  }
  const activeProvider = (settings.active_provider as ProviderId) in providers
    ? (settings.active_provider as ProviderId)
    : 'gemini';
  const available = await getAvailableProviders();
  const ordered: ProviderId[] = [activeProvider, ...available.filter((id) => id !== activeProvider)];
  return ordered.map((providerId) => ({ providerId, model: getModelForProvider(providerId, settings) }));
}

/**
 * Budget hard-gate (M1-02) — the single choke point every real AI call
 * passes through, regardless of whether the caller used the Dynamic Model
 * Router. checkBudget() previously existed but nothing called it before an
 * actual spend; lib/ai/router/index.ts's own budget filtering only applies
 * to callers that go through route() first (missions), leaving every other
 * chatWithFallback/streamWithFallback caller (chat, tool planning, memory
 * summarization, intent classification) completely unchecked.
 *
 * Ollama is self-hosted with zero marginal cost (lib/ai/pricing.ts already
 * treats it as `cost: 0, isEstimated: false`) — exempt from the gate rather
 * than blocked, so an over-budget tenant still gets best-effort local
 * service instead of a hard stop when Ollama is configured.
 *
 * A caller with no tenantId in its usageContext (internal system calls that
 * predate tenant attribution — tool planning, memory summarization, intent
 * classification) is not gated: there's no tenant to check a budget against,
 * matching checkBudget()'s own "no budget row configured" = unlimited
 * posture rather than inventing a new failure mode for those call sites.
 */
async function applyBudgetGate(
  pairs: { providerId: ProviderId; model: string }[],
  tenantId: string | null | undefined,
): Promise<{ providerId: ProviderId; model: string }[]> {
  if (!tenantId) return pairs;

  const budget = await checkBudget(tenantId);
  if (budget.withinBudget) return pairs;

  const freePairs = pairs.filter((p) => p.providerId === 'ollama');
  if (freePairs.length > 0) return freePairs;

  throw new Error(
    `Monthly AI budget exceeded ($${budget.spendUsd.toFixed(2)} / $${(budget.limitUsd ?? 0).toFixed(2)}). Raise the budget in Settings or wait for the next billing period.`,
  );
}

/**
 * Chat with automatic provider fallback.
 * Tries the active provider first, then falls through the chain — unless
 * the caller supplies router candidates (see resolveOrderedPairs above).
 */
export async function chatWithFallback(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const settings = await loadSettings();
  let pairs = await resolveOrderedPairs(options, settings);
  pairs = await applyBudgetGate(pairs, options.usageContext?.tenantId);

  let lastError: AIProviderError | null = null;

  for (const { providerId, model } of pairs) {
    const provider = getProvider(providerId);
    const start = Date.now();
    try {
      logger.provider(`Trying ${providerId}`, { model });
      const result = await provider.chat(messages, { ...options, model });
      const latencyMs = Date.now() - start;
      if (pairs[0].providerId !== providerId) {
        logger.providerSwitch(pairs[0].providerId, providerId, 'fallback');
      }
      // Non-blocking usage recording: never delays or fails the caller.
      await recordUsage({
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        context: options.usageContext,
        latencyMs,
      });
      recordHealth({ provider: providerId, modelId: model, success: true, latencyMs, statusCode: 200 });
      return result;
    } catch (err) {
      lastError = err instanceof AIProviderError ? err : new AIProviderError(String(err), 0, providerId);
      recordHealth({ provider: providerId, modelId: model, success: false, latencyMs: Date.now() - start, statusCode: lastError.status });
      logger.providerWarn(`${providerId} failed: ${lastError.message}`);
      // M2-02: an IP-level rate limit applies identically to every
      // provider (it's checked before the edge function even looks at
      // which one was requested) — cycling through the rest of the
      // fallback chain would just repeat the same block. Fail fast.
      if (lastError.code === 'rate_limited') break;
      continue;
    }
  }

  const friendlyMessage = getFriendlyError(lastError);
  throw new Error(friendlyMessage);
}

/**
 * Stream chat with automatic provider fallback.
 * If the active provider fails after retries, switches to the next.
 */
export async function streamWithFallback(
  messages: ChatMessage[],
  options: ChatOptions & { onDelta: StreamCallback },
): Promise<string> {
  const settings = await loadSettings();
  let pairs = await resolveOrderedPairs(options, settings);
  pairs = await applyBudgetGate(pairs, options.usageContext?.tenantId);

  let lastError: AIProviderError | null = null;

  for (const { providerId, model } of pairs) {
    const provider = getProvider(providerId);
    const start = Date.now();
    try {
      logger.provider(`Streaming via ${providerId}`, { model });
      const result = await provider.chatStream(messages, { ...options, model });
      const latencyMs = Date.now() - start;
      if (pairs[0].providerId !== providerId) {
        logger.providerSwitch(pairs[0].providerId, providerId, 'fallback');
      }
      // Mirrors chatWithFallback's usage recording — previously only the
      // non-streaming path recorded usage, so every streamed chat/voice
      // response was invisible to the Usage Ledger and budget governance.
      await recordUsage({
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        context: options.usageContext,
        latencyMs,
      });
      recordHealth({ provider: providerId, modelId: model, success: true, latencyMs, statusCode: 200 });
      return result.content;
    } catch (err) {
      lastError = err instanceof AIProviderError ? err : new AIProviderError(String(err), 0, providerId);
      recordHealth({ provider: providerId, modelId: model, success: false, latencyMs: Date.now() - start, statusCode: lastError.status });
      logger.providerWarn(`${providerId} stream failed: ${lastError.message}`);
      if (lastError.code === 'rate_limited') break;
      continue;
    }
  }

  const friendlyMessage = getFriendlyError(lastError);
  throw new Error(friendlyMessage);
}

function getModelForProvider(providerId: ProviderId, settings: AppSettings): string {
  const field = PROVIDER_MODEL_FIELD[providerId];
  const value = settings[field];
  return typeof value === 'string' && value ? value : '';
}

function getFriendlyError(error: AIProviderError | null): string {
  if (!error) return 'AI request failed for an unknown reason.';
  if (error.code === 'rate_limited') {
    return error.message; // already the precise "Too many requests. Try again in Ns." from the edge function
  }
  if (error.status === 429) {
    return 'All AI providers are currently rate-limited. Please wait a moment and try again.';
  }
  if (error.status === 401) {
    return 'No AI providers are configured. Please add an API key in Settings to start chatting.';
  }
  if (error.status === 0) {
    return 'Could not reach the AI service. Please check your internet connection and try again.';
  }
  return `AI request failed: ${error.message}. Please try again or check your Settings.`;
}

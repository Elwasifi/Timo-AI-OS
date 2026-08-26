// Shared types for the ai-chat edge function adapter registry.

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  content: string;
  usage: Usage;
}

/** Runtime context handed to every adapter call. */
export interface ChatContext {
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  model: string;
  stream: boolean;
  /** Optional tool definitions (provider-specific shaping handled by adapter). */
  tools?: ToolDef[];
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Retry policy owned by each provider. The dispatcher honors these values
 * instead of using a single global constant, so a flaky local provider
 * (Ollama) can be retried differently from a rate-limited cloud API.
 */
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatuses: number[];
}

/**
 * Every provider owns its endpoint, authentication, models, streaming,
 * tool-calling shape, and retry policy. The dispatcher is provider-agnostic.
 */
export interface AIProviderAdapter {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];

  /** Whether tool calling is supported by this provider. */
  supportsTools: boolean;

  retry: RetryPolicy;

  /** True when this provider needs an API key to function. */
  requiresKey: boolean;

  /**
   * Resolve the request URL. May depend on model (e.g. Gemini embeds the
   * model in the path) and on whether this is a streaming request.
   */
  resolveUrl(opts: { model: string; stream: boolean; apiKey: string; baseUrl?: string }): string;

  /** Build the full header set, including auth and content-type. */
  buildHeaders(apiKey: string, baseUrl?: string): Record<string, string>;

  /** Shape the request body for this provider. */
  buildPayload(ctx: ChatContext): Record<string, unknown>;

  /** Parse a non-streaming JSON response into content + usage. */
  parseChatResponse(data: unknown): ChatResult;

  /** Parse one SSE/stream line into a delta string, or null to skip. */
  parseStreamChunk(line: string): string | null;

  /**
   * List currently-available models from the provider's own catalog
   * endpoint, using the given key/baseUrl directly (NOT read from
   * app_settings — this is also used to validate a key the user hasn't
   * saved yet). Doubles as credential validation: a successful call proves
   * the key works. Throws UpstreamError (see index.ts) with the real
   * status on failure so the caller can classify invalid-key vs.
   * rate-limited vs. unavailable correctly.
   */
  listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;
}

/**
 * Real, provider-reported model metadata only — never fabricated. Any field
 * the provider's catalog endpoint doesn't return stays undefined/null rather
 * than being guessed (Provider Validation & Model Discovery pass, 2026-08-20).
 */
export interface ModelInfo {
  id: string;
  displayName?: string;
  contextLength?: number;
  /** USD per 1M input tokens, or null if the provider doesn't expose pricing. */
  inputPrice?: number | null;
  /** USD per 1M output tokens, or null if the provider doesn't expose pricing. */
  outputPrice?: number | null;
  /** true/false only when the provider's own data makes it unambiguous (e.g. local Ollama, or OpenRouter's $0 pricing); null = unknown, never guessed. */
  free?: boolean | null;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
}

export type ProviderId = 'gemini' | 'groq' | 'nvidia' | 'openrouter' | 'ollama';

/** Persisted provider configuration read from app_settings (single source of truth). */
export interface ProviderConfig {
  apiKey: string | null;
  model: string;
  baseUrl?: string | null;
}

export type ProviderConfigMap = Record<ProviderId, ProviderConfig>;

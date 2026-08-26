import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { REGISTRY, getAdapter, isProviderId, FALLBACK_ORDER } from "./registry.ts";
import type { ChatContext, ProviderConfigMap, ProviderId, ProviderConfig, ModelInfo } from "./types.ts";
import { UpstreamError, fetchWithTimeout } from "./http.ts";

// Minimal Deno type declarations for the edge function environment
declare global {
  const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (req: Request) => Response | Promise<Response>): void;
    readonly cwd: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatRequest {
  action?: 'chat';
  provider: ProviderId;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  stream?: boolean;
  tools?: ChatContext['tools'];
}

interface ValidateRequest {
  action: 'validate';
  provider: ProviderId;
  /**
   * Omit to validate the currently-saved key from app_settings. Pass an
   * explicit value (including '') to validate a key the user has typed but
   * not saved yet — this is why the key travels in the request body rather
   * than always being read server-side: there's nothing saved to read yet.
   */
  apiKey?: string;
  baseUrl?: string;
}

type ValidationStatus =
  | 'connected'
  | 'not_configured'
  | 'invalid_api_key'
  | 'unauthorized'
  | 'unsupported'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'configuration_error'
  | 'unknown_error';

function classifyValidationStatus(status: number, rawMessage: string): ValidationStatus {
  if (status === 401) return 'invalid_api_key';
  if (status === 403) return 'unauthorized';
  if (status === 404) return 'unsupported';
  if (status === 400) {
    // Some providers (confirmed live for Gemini: "API_KEY_INVALID",
    // "API key not valid") report a bad key as 400 rather than 401/403.
    // Detected from the real error text rather than assumed for every 400.
    if (/api[_ ]?key/i.test(rawMessage) && /invalid|not valid/i.test(rawMessage)) {
      return 'invalid_api_key';
    }
    return 'configuration_error';
  }
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'provider_timeout';
  if (status === 502 || status === 503) return 'provider_unavailable';
  return 'unknown_error';
}

/**
 * SINGLE SOURCE OF TRUTH: provider keys and models live in the app_settings
 * table, not in edge-function secrets. The edge function reads them at request
 * time using the service role (bypasses RLS). This eliminates the dual-config
 * drift that caused OpenRouter keys to be sent to the OpenAI endpoint.
 */
function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Server is missing Supabase admin credentials.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SettingsRow {
  active_provider: string | null;
  gemini_api_key: string | null;
  gemini_model: string | null;
  groq_api_key: string | null;
  groq_model: string | null;
  nvidia_api_key: string | null;
  nvidia_model: string | null;
  openrouter_api_key: string | null;
  openrouter_model: string | null;
  ollama_base_url: string | null;
  ollama_api_key: string | null;
  ollama_model: string | null;
}

/** Read the full provider configuration map from app_settings (singleton row). */
async function loadProviderConfigs(): Promise<{
  configs: ProviderConfigMap;
  activeProvider: ProviderId;
}> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Failed to read provider settings: ${error.message}`);
  const row = (data ?? {}) as Partial<SettingsRow>;

  const cfg = (id: ProviderId, apiKey: string | null, model: string | null, baseUrl?: string | null): ProviderConfig => ({
    apiKey: apiKey ?? null,
    model: model || REGISTRY[id].defaultModel,
    baseUrl: baseUrl ?? null,
  });

  const configs: ProviderConfigMap = {
    gemini: cfg('gemini', row.gemini_api_key, row.gemini_model),
    groq: cfg('groq', row.groq_api_key, row.groq_model),
    nvidia: cfg('nvidia', row.nvidia_api_key, row.nvidia_model),
    openrouter: cfg('openrouter', row.openrouter_api_key, row.openrouter_model),
    ollama: cfg('ollama', row.ollama_api_key ?? null, row.ollama_model, row.ollama_base_url),
  };

  const rawActive = row.active_provider ?? 'gemini';
  const activeProvider: ProviderId = isProviderId(rawActive) ? rawActive : 'gemini';
  return { configs, activeProvider };
}

/**
 * Persist real discovery results to provider_model_catalog (Dynamic Model
 * Router foundation, 2026-08-20) — replaces the whole set for this
 * provider each time, since a stale model that's dropped out of the
 * provider's real catalog should stop being a routable candidate rather
 * than lingering forever.
 */
async function persistCatalog(provider: ProviderId, models: ModelInfo[]): Promise<void> {
  // An empty result is treated as "nothing to update" rather than "clear
  // the catalog" — a transient empty response from a real connection must
  // never wipe out a previously-good, still-probably-accurate catalog
  // (mission: "keep the existing cached list... do not erase the user's
  // existing configuration").
  if (models.length === 0) return;
  const supabase = getSupabaseAdmin();
  await supabase.from('provider_model_catalog').delete().eq('provider', provider);
  const rows = models.map((m) => ({
    provider,
    model_id: m.id,
    display_name: m.displayName ?? null,
    context_length: m.contextLength ?? null,
    input_price: m.inputPrice ?? null,
    output_price: m.outputPrice ?? null,
    free: m.free ?? null,
    supports_streaming: m.supportsStreaming ?? null,
    supports_tools: m.supportsTools ?? null,
    validated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('provider_model_catalog').upsert(rows, { onConflict: 'provider,model_id' });
  if (error) throw new Error(`Catalog persistence failed: ${error.message}`);
}

/** Resolve the effective key + model for a provider, applying per-provider rules. */
function resolveProviderConfig(
  id: ProviderId,
  configs: ProviderConfigMap,
  requestModel?: string,
): { apiKey: string | null; model: string; baseUrl?: string | null } {
  const adapter = REGISTRY[id];
  const config = configs[id];
  const model = requestModel || config.model || adapter.defaultModel;
  const apiKey = config.apiKey;
  // Ollama base URL is configurable; others use the adapter's fixed base URL.
  const baseUrl = id === 'ollama' ? (config.baseUrl || 'http://localhost:11434/api') : undefined;
  return { apiKey, model, baseUrl };
}

/**
 * Credential validation + model discovery in one lightweight round trip —
 * listing a provider's model catalog is both cheap (no generation billed)
 * and doubles as auth proof (a bad key fails the same call). Never logs or
 * echoes the API key back; the response carries only status/message/models.
 */
async function handleValidate(body: ValidateRequest): Promise<Response> {
  const { provider, baseUrl: requestBaseUrl } = body;
  if (!provider || !isProviderId(provider)) {
    return jsonValidation('configuration_error', `Unsupported provider: ${provider}`);
  }

  const adapter = getAdapter(provider)!;

  // Resolve the key to test: an explicit (possibly unsaved) value from the
  // request takes priority; otherwise fall back to what's already saved.
  let apiKey = body.apiKey;
  let baseUrl = requestBaseUrl;
  if (apiKey === undefined) {
    try {
      const { configs } = await loadProviderConfigs();
      const resolved = resolveProviderConfig(provider, configs);
      apiKey = resolved.apiKey ?? undefined;
      baseUrl = baseUrl ?? resolved.baseUrl ?? undefined;
    } catch (err) {
      return jsonValidation('unknown_error', err instanceof Error ? err.message : 'Failed to read saved settings');
    }
  }
  if (provider === 'ollama') {
    baseUrl = baseUrl || 'http://localhost:11434/api';
  }

  if (adapter.requiresKey && !apiKey) {
    return jsonValidation('not_configured', `No API key configured for ${adapter.label}. Enter one above and click Validate.`);
  }

  try {
    const models = await adapter.listModels(apiKey ?? '', baseUrl);
    // Dynamic Model Router foundation (2026-08-20): persist real discovery
    // results server-side so a server-context caller (mission execution,
    // lib/ai/router) can read them. Previously this data only ever reached
    // the browser's response body / localStorage — completely unreachable
    // from Next.js API routes or edge-function-triggered mission runs.
    // Best-effort: a persistence failure must never break the validation
    // response the Settings UI is waiting on.
    try {
      await persistCatalog(provider, models);
    } catch (persistErr) {
      console.warn('[ai-chat:validate] catalog persistence failed:', persistErr instanceof Error ? persistErr.message : persistErr);
    }
    return jsonValidation(
      'connected',
      `${adapter.label} connection successful.`,
      models,
    );
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 0;
    const rawMessage = err instanceof Error ? err.message : 'Unknown error';
    const validationStatus = status === 0 ? 'unknown_error' : classifyValidationStatus(status, rawMessage);
    // Provider error bodies can be verbose/technical (and in rare adapter
    // bugs could theoretically echo request data) — never forward them
    // verbatim; map to a short, safe, human-readable message instead.
    const message = FRIENDLY_VALIDATION_MESSAGES[validationStatus](adapter.label);
    console.warn(`[ai-chat:validate] ${adapter.label} failed (${validationStatus}):`, rawMessage.slice(0, 200));
    return jsonValidation(validationStatus, message);
  }
}

const FRIENDLY_VALIDATION_MESSAGES: Record<ValidationStatus, (label: string) => string> = {
  connected: (l) => `${l} connection successful.`,
  not_configured: (l) => `No API key configured for ${l}.`,
  invalid_api_key: (l) => `Invalid ${l} API key.`,
  unauthorized: (l) => `${l} rejected this key (unauthorized).`,
  unsupported: (l) => `${l} does not support model discovery at this endpoint.`,
  rate_limited: (l) => `${l} is rate-limiting requests right now. Try again shortly.`,
  provider_unavailable: (l) => `${l} is temporarily unavailable.`,
  provider_timeout: (l) => `${l} did not respond in time.`,
  configuration_error: (l) => `${l} configuration is invalid.`,
  unknown_error: (l) => `Could not validate ${l} — an unexpected error occurred.`,
};

function jsonValidation(status: ValidationStatus, message: string, models?: unknown): Response {
  return new Response(JSON.stringify({ status, message, models: models ?? undefined }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json() as ChatRequest | ValidateRequest;

    if (body.action === 'validate') {
      return await handleValidate(body);
    }

    const {
      provider,
      messages,
      systemPrompt,
      temperature = 0.7,
      maxTokens = 2048,
      model,
      stream = false,
      tools,
    } = body as ChatRequest;

    if (!provider || !messages || !Array.isArray(messages)) {
      return jsonError(400, "Missing required fields: provider, messages");
    }
    if (!isProviderId(provider)) {
      return jsonError(400, `Unsupported provider: ${provider}. Supported: gemini, groq, nvidia, openrouter, ollama`);
    }

    const { configs } = await loadProviderConfigs();
    const { apiKey, model: effectiveModel, baseUrl } = resolveProviderConfig(provider, configs, model);

    const adapter = getAdapter(provider)!;
    if (adapter.requiresKey && !apiKey) {
      return jsonError(401, `No API key configured for provider "${provider}". Add it in Settings.`);
    }

    const ctx: ChatContext = {
      messages,
      systemPrompt,
      temperature,
      maxTokens,
      model: effectiveModel,
      stream,
      tools,
    };

    if (stream) {
      return handleStream(adapter, ctx, apiKey ?? '', baseUrl);
    }

    const result = await handleChat(adapter, ctx, apiKey ?? '', baseUrl);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof UpstreamError ? err.status : 500;
    return jsonError(status, message);
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleChat(
  adapter: ReturnType<typeof getAdapter> & {},
  ctx: ChatContext,
  apiKey: string,
  baseUrl?: string | null,
): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number }; model: string }> {
  const a = adapter as NonNullable<ReturnType<typeof getAdapter>>;
  const url = a.resolveUrl({ model: ctx.model, stream: false, apiKey, baseUrl });
  const headers = a.buildHeaders(apiKey, baseUrl ?? undefined);
  const payload = a.buildPayload(ctx);

  const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload) }, a.label);
  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamError(`${a.label} API error (${res.status}): ${errText}`, res.status);
  }
  const data = await res.json();
  const parsed = a.parseChatResponse(data);
  // Echo back the resolved model (may differ from the client's request when
  // no model was specified and a provider default was applied server-side)
  // so the client can attribute usage accurately — Sprint 3 cost governance.
  return { ...parsed, model: ctx.model };
}

// Rough token estimate (~4 chars/token, the commonly-cited English-text
// average) for the streaming path, which has no exact counts. Not used for
// the non-streaming path — that reports the provider's real usage figures.
function estimateUsage(
  ctx: ChatContext,
  outputText: string,
): { inputTokens: number; outputTokens: number; estimated: true } {
  const inputChars =
    (ctx.systemPrompt?.length ?? 0) +
    ctx.messages.reduce((sum, m) => sum + m.content.length, 0);
  return {
    inputTokens: Math.ceil(inputChars / 4),
    outputTokens: Math.ceil(outputText.length / 4),
    estimated: true,
  };
}

async function handleStream(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  ctx: ChatContext,
  apiKey: string,
  baseUrl?: string | null,
): Promise<Response> {
  const url = adapter.resolveUrl({ model: ctx.model, stream: true, apiKey, baseUrl });
  const headers = adapter.buildHeaders(apiKey, baseUrl ?? undefined);
  const payload = adapter.buildPayload(ctx);

  // The initial connection attempt happens BEFORE the streaming Response is
  // constructed, not inside the ReadableStream — once new Response(stream)
  // is returned, the HTTP status is committed to 200 regardless of what
  // happens inside the stream body, which is what previously forced every
  // streaming failure (invalid model, bad key, timeout) to be reported as
  // a 200 with an embedded {error} payload instead of a real HTTP status
  // the client's existing status-based retry logic could act on correctly.
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload) }, adapter.label);
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 502;
    const message = err instanceof Error ? err.message : 'Stream connection failed';
    return jsonError(status, message);
  }
  if (!res.ok || !res.body) {
    const errText = await res.text();
    return jsonError(res.status, `Stream failed (${res.status}): ${errText}`);
  }

  const upstreamBody = res.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const chunk = adapter.parseStreamChunk(line);
            if (chunk) {
              full += chunk;
              controller.enqueue(encoder.encode(JSON.stringify({ delta: chunk }) + '\n'));
            }
          }
        }
        // Streaming provider APIs generally don't return token counts inline
        // per-chunk, so exact usage isn't available here the way the
        // non-streaming path gets it from the response body. Emitting a
        // rough char/4 estimate (marked `estimated: true`) is still strictly
        // better than recording zero usage for every streamed response —
        // Sprint 3 cost governance needs *some* signal for streamed calls.
        const usage = estimateUsage(ctx, full);
        controller.enqueue(encoder.encode(JSON.stringify({ done: true, usage }) + '\n'));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        controller.enqueue(encoder.encode(JSON.stringify({ error: message }) + '\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}

// Re-export so downstream tooling can introspect the supported stack.
export { FALLBACK_ORDER, REGISTRY };

import type { ProviderId } from '@/lib/settings/settings-service';
import { FALLBACK_ORDER, loadSettings, PROVIDER_KEY_FIELD, PROVIDER_MODEL_FIELD, type AppSettings } from '@/lib/settings/settings-service';
import { logger } from '@/lib/utils/logger';
import { recordUsage, type UsageContext } from './usageLedger';
import { recordHealth, getHealth, getAllHealth, isProvenHealth } from './router/healthTracker';
import { checkBudget } from '@/lib/governance/entitlements';
import { requiresByok, loadTenantProviderConfig, ByokNotConfiguredError } from '@/lib/settings/tenantConfiguredProviders';

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
  /** M7-13e: per-request ceiling override (ms) for ONE provider attempt; omit to derive it from the call type — see requestTimeoutFor(). */
  timeoutMs?: number;
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

/**
 * M7-13e: per-request ceiling for one provider call through the ai-chat edge
 * function. Before this, `fetch` had no timeout at all — one stalled
 * provider left the whole chat on "THINKING" indefinitely, with no
 * "Trying <next provider>" line ever logged. Non-streaming calls get this
 * as a total deadline; streaming calls get it as an IDLE deadline (reset on
 * every received chunk) so a long answer that keeps flowing is never cut
 * off, only a stalled one. A timeout surfaces as AIProviderError status 408
 * / code 'timeout' — not retried (a stalled provider will most likely stall
 * again; the fallback chain moves on instead).
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = 20_000;
/** Long non-streaming generations (mission task execution, worker/manager delegation, tool loops, big drafts). */
export const LONG_GENERATION_TIMEOUT_MS = 90_000;
/** maxTokens above the 2048 chat default implies a long output. */
export const LARGE_OUTPUT_TIMEOUT_MS = 60_000;
const LONG_GENERATION_OPERATIONS = new Set([
  'mission_task', 'worker_execution', 'manager_review', 'chat_tool_loop', 'tool_response', 'operator_workflow_draft',
]);

/**
 * The per-attempt ceiling depends on what is being generated, so a legitimate
 * long answer is never cut off by the tight limit that protects short calls:
 *   explicit options.timeoutMs        -> as given
 *   mission/delegation/tool-loop ops  -> 90s (LONG_GENERATION_OPERATIONS)
 *   maxTokens > 2048                  -> 60s
 *   everything else (chat, intent, memory, acknowledgments, tool planning) -> 20s
 * Streaming calls use the value as an IDLE limit (reset per chunk), so a long
 * streamed reply is never cut while it is flowing.
 */
export function requestTimeoutFor(options: ChatOptions): number {
  if (options.timeoutMs && options.timeoutMs > 0) return options.timeoutMs;
  const op = options.usageContext?.operation;
  if (op && LONG_GENERATION_OPERATIONS.has(op)) return LONG_GENERATION_TIMEOUT_MS;
  if ((options.maxTokens ?? 2048) > 2048) return LARGE_OUTPUT_TIMEOUT_MS;
  return PROVIDER_REQUEST_TIMEOUT_MS;
}

/**
 * Overall deadline for INTERACTIVE calls (chat / voice / intent / memory:
 * anything that gets the short 20s per-attempt limit). Without it a plain
 * chat could spend 20s x 3 fallback attempts (60s) — longer than the chat
 * page's 40s inactivity watchdog, which would then fire first and show a
 * generic stall instead of a clean error. 30s total sits clearly below that
 * watchdog; each attempt is also capped to the time remaining. Mission /
 * worker / long-generation calls (per-attempt limit > 20s) are NOT subject
 * to it and keep their 60-90s per-attempt limits unchanged.
 */
export const INTERACTIVE_DEADLINE_MS = 30_000;
/** Don't start another provider attempt with less than this left — it could not finish. */
const MIN_ATTEMPT_MS = 1_500;

export function isInteractiveCall(options: ChatOptions): boolean {
  return requestTimeoutFor(options) <= PROVIDER_REQUEST_TIMEOUT_MS;
}

function deadlineError(providerId: ProviderId): AIProviderError {
  return new AIProviderError(
    `The AI is taking too long to respond (${INTERACTIVE_DEADLINE_MS / 1000}s limit reached across providers). Please try again in a moment.`,
    408,
    providerId,
    'deadline',
  );
}

function startRequestTimer(providerId: ProviderId, ms: number = PROVIDER_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const fire = () => { timedOut = true; controller.abort(); };
  let timer = setTimeout(fire, ms);
  return {
    signal: controller.signal,
    /** Reset the deadline (streaming: called per received chunk). */
    touch() { clearTimeout(timer); timer = setTimeout(fire, ms); },
    stop() { clearTimeout(timer); },
    timedOut: () => timedOut,
    error: () => new AIProviderError(`${providerId} did not respond within ${Math.round(ms / 1000)}s`, 408, providerId, 'timeout'),
  };
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
      const timer = startRequestTimer(this.id, requestTimeoutFor(options));
      try {
        const body = {
          provider: this.id,
          messages,
          systemPrompt: options.systemPrompt,
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? 2048,
          model: options.model,
          stream: false,
          // M7-09 (BYOK): trusted tenantId, already resolved server-side by
          // every real caller before it ever reaches usageContext.
          tenantId: options.usageContext?.tenantId ?? null,
        };

        logger.aiDebug(`${this.id} chat attempt ${attempt + 1}/3`);

        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(body),
          signal: timer.signal,
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
        if (timer.timedOut()) throw timer.error();
        if (err instanceof AIProviderError) throw err;
        if (attempt < 2) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw new AIProviderError(err instanceof Error ? err.message : 'Network error', 0, this.id);
      } finally {
        timer.stop();
      }
    }
    throw new AIProviderError('Exhausted retries', 500, this.id);
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions & { onDelta: StreamCallback }
  ): Promise<StreamResult> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      const timer = startRequestTimer(this.id, requestTimeoutFor(options));
      try {
        const body = {
          provider: this.id,
          messages,
          systemPrompt: options.systemPrompt,
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens ?? 2048,
          model: options.model,
          stream: true,
          tenantId: options.usageContext?.tenantId ?? null,
        };

        logger.aiDebug(`${this.id} stream attempt ${attempt + 1}/3`);

        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(body),
          signal: timer.signal,
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
          timer.touch();
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
        if (timer.timedOut()) throw timer.error();
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
      } finally {
        timer.stop();
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
    const routed = options.candidates.map((c) => ({ providerId: c.provider, model: c.model }));
    // M7-13e last-resort tier (CLIENT tenants only): the router's candidate
    // list is deliberately narrow (trusted pool, proven models), so a tenant
    // whose groq + gemini candidates all fail would otherwise get an error
    // even with other working keys configured (e.g. openrouter). After every
    // router candidate, append the tenant's remaining configured providers
    // (pinned model, else the provider default). Never for a provider whose
    // circuit is open for this tenant, and still bounded by the interactive
    // deadline in the fallback loops. Internal tenant: untouched.
    const extraTenantId = options.usageContext?.tenantId;
    if (!requiresByok(extraTenantId)) return routed;
    const cfg = await loadTenantProviderConfig(extraTenantId as string);
    if (!cfg) return routed;
    const routedProviders = new Set(routed.map((p) => p.providerId));
    const extras = FALLBACK_ORDER
      .filter((id) => cfg.some((c) => c.provider === id) && !routedProviders.has(id))
      .map((providerId) => ({
        providerId,
        model: cfg.find((c) => c.provider === providerId)?.model || getModelForProvider(providerId, settings),
      }))
      .filter((p) => !isCircuitOpen(extraTenantId, p.providerId, p.model));
    return [...routed, ...extras];
  }
  // M7-13e: a CLIENT (BYOK) tenant's default chain is built from ITS OWN
  // configured providers (names + pinned models; never key values), not from
  // app_settings (internal tenant only — for anyone else it is empty
  // defaults, which used to make every provider look available and cost a
  // wasted 401 round trip per unconfigured one). No keys at all is a clear,
  // typed error — never a silent fallback onto the internal tenant's keys.
  const byokTenantId = options.usageContext?.tenantId;
  if (requiresByok(byokTenantId)) {
    const cfg = await loadTenantProviderConfig(byokTenantId as string);
    if (cfg && cfg.length === 0) throw new ByokNotConfiguredError();
    if (cfg) {
      return FALLBACK_ORDER.filter((id) => cfg.some((c) => c.provider === id)).map((providerId) => ({
        providerId,
        model: cfg.find((c) => c.provider === providerId)?.model || getModelForProvider(providerId, settings),
      }));
    }
    // cfg === null: the config read failed — unknown, so keep the previous behavior below.
  }
  const activeProvider = (settings.active_provider as ProviderId) in providers
    ? (settings.active_provider as ProviderId)
    : 'gemini';
  const available = await getAvailableProviders();
  const ordered: ProviderId[] = [activeProvider, ...available.filter((id) => id !== activeProvider)];
  return ordered.map((providerId) => ({ providerId, model: getModelForProvider(providerId, settings) }));
}

// ---- M7-13e: hard-failure circuit breaker + track-record ordering ----
//
// Confirmed live (Amro's failing chain): nvidia/meta/llama-3.1-405b-instruct
// returns 404 on EVERY call (M7-12b), yet every chat turn still tried it —
// and the post-reply memory step tried it again — paying a round trip each
// time. A 404/410 (model gone) or 401/403 (key rejected) will not fix
// itself within a session, so after one such failure the pair is skipped
// for CIRCUIT_COOLDOWN_MS. 401/403 are a property of the key, so they open
// the circuit for the whole provider (`provider::*`); 404/410 only for the
// specific model. In-memory (per tab) on purpose: the persisted health
// table's last_status_code is overwritten by later calls and can't be
// trusted for this; persisted history is instead used below via the
// zero-success rule.
export const CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000;
const HARD_FAILURE_STATUSES = new Set([401, 403, 404, 410]);
const PROVIDER_WIDE_STATUSES = new Set([401, 403]);
const circuitOpenUntil = new Map<string, number>();

// Circuits are scoped PER TENANT. A 401/403 means THIS tenant's key was
// rejected, and even a 404 can be tenant-specific ("does not exist or you do
// not have access to it"). lib/ai also runs server-side (task queue, API
// routes) where one process serves many tenants, so an unscoped key would
// let tenant A's bad key disable a provider for tenant B. Calls with no
// tenant (internal system calls) share the 'internal' bucket.
const tenantScope = (tenantId?: string | null) => tenantId || 'internal';
const circuitKey = (tenantId: string | null | undefined, providerId: ProviderId, model: string) =>
  `${tenantScope(tenantId)}::${providerId}::${model}`;

export function isCircuitOpen(tenantId: string | null | undefined, providerId: ProviderId, model: string, now: number = Date.now()): boolean {
  const modelUntil = circuitOpenUntil.get(circuitKey(tenantId, providerId, model));
  const providerUntil = circuitOpenUntil.get(circuitKey(tenantId, providerId, '*'));
  return (modelUntil !== undefined && now < modelUntil) || (providerUntil !== undefined && now < providerUntil);
}

export function tripCircuitIfHardFailure(tenantId: string | null | undefined, providerId: ProviderId, model: string, status: number): boolean {
  if (!HARD_FAILURE_STATUSES.has(status)) return false;
  const providerWide = PROVIDER_WIDE_STATUSES.has(status);
  circuitOpenUntil.set(providerWide ? circuitKey(tenantId, providerId, '*') : circuitKey(tenantId, providerId, model), Date.now() + CIRCUIT_COOLDOWN_MS);
  logger.providerWarn(
    `Circuit open for ${providerWide ? providerId + ' (all models)' : providerId + '/' + model} — HTTP ${status} is a hard failure, skipping it for ${CIRCUIT_COOLDOWN_MS / 60000} minutes`,
  );
  return true;
}

/** Clear open circuits — e.g. after a tenant saves a new API key, so a fixed key is retried immediately. Scoped to the given tenant (and provider, if given); with no arguments clears everything (tests). */
export function resetProviderCircuits(tenantId?: string | null, providerId?: ProviderId): void {
  if (tenantId === undefined && !providerId) { circuitOpenUntil.clear(); return; }
  const prefix = providerId ? `${tenantScope(tenantId)}::${providerId}::` : `${tenantScope(tenantId)}::`;
  Array.from(circuitOpenUntil.keys()).forEach((k) => { if (k.startsWith(prefix)) circuitOpenUntil.delete(k); });
}

type ProviderPair = { providerId: ProviderId; model: string };

/**
 * Orders/filters the fallback chain by real track record:
 *   proven (best expected time-to-answer first) -> unknown/unproven -> pairs
 *   that have NEVER succeeded (0 successes with failures) -> open circuits.
 * The last two tiers are only kept when nothing better exists, so a broken
 * provider is never retried "for variety" while a working one is available,
 * yet a tenant whose ONLY configured provider looks broken still gets a
 * real attempt instead of an immediate refusal.
 *
 * Router-supplied candidates (`fromRouter`) keep the router's own order —
 * it already scored them and may deliberately put an unproven model first
 * for mission/reasoning work, or honor a manual pick — they only get the
 * dead-pair filtering. The default chain (no router candidates, e.g. a
 * BYOK tenant whose app_settings is not readable) gets the full ordering.
 */
export async function prioritizePairs(
  pairs: ProviderPair[],
  fromRouter: boolean,
  tenantId?: string | null,
): Promise<{ pairs: ProviderPair[]; lastResort: boolean }> {
  if (pairs.length <= 1) return { pairs, lastResort: false };
  const health = await getAllHealth();
  const providerSuccesses = new Map<ProviderId, number>();
  health.forEach((h) => providerSuccesses.set(h.provider, (providerSuccesses.get(h.provider) ?? 0) + h.successCount));

  const tierOf = (p: ProviderPair): number => {
    if (isCircuitOpen(tenantId, p.providerId, p.model)) return 3;
    const h = health.get(`${p.providerId}::${p.model}`);
    const neverWorked =
      (!!h && h.successCount === 0 && h.failureCount > 0) ||
      (providerSuccesses.has(p.providerId) && providerSuccesses.get(p.providerId) === 0);
    if (neverWorked) return 2;
    return isProvenHealth(h) ? 0 : 1;
  };
  // Expected time to a good answer: avg latency inflated by the failure rate.
  const costOf = (p: ProviderPair): number => {
    const h = health.get(`${p.providerId}::${p.model}`);
    if (!h || h.avgLatencyMs === null) return Number.POSITIVE_INFINITY;
    const total = h.successCount + h.failureCount;
    return h.avgLatencyMs / Math.max(0.01, total > 0 ? h.successCount / total : 1);
  };

  const tagged = pairs.map((p, i) => ({ p, i, tier: tierOf(p) }));
  const good = tagged.filter((t) => t.tier <= 1);
  if (good.length > 0) {
    const ordered = fromRouter
      ? good.sort((a, b) => a.i - b.i)
      : good.sort((a, b) => a.tier - b.tier || (a.tier === 0 ? costOf(a.p) - costOf(b.p) : 0) || a.i - b.i);
    return { pairs: ordered.map((t) => t.p), lastResort: false };
  }
  // Nothing healthy: try what exists, never-worked before open-circuit.
  return { pairs: tagged.sort((a, b) => a.tier - b.tier || a.i - b.i).map((t) => t.p), lastResort: true };
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

// M3-01: a provider/model that has failed repeatedly and recently is
// skipped outright — no request attempt, no 3x retry/backoff — rather than
// paying its full retry cost again on every single call within the
// cooldown window. Thresholds are deliberately conservative (3 consecutive
// failures, 5 minutes) so a genuinely transient blip doesn't blacklist a
// provider that would otherwise have recovered on the very next call.
const UNHEALTHY_CONSECUTIVE_FAILURES = 3;
const UNHEALTHY_COOLDOWN_MS = 5 * 60 * 1000;

async function isSkippableUnhealthy(providerId: ProviderId, model: string): Promise<boolean> {
  const health = await getHealth(providerId, model);
  if (!health || health.consecutiveFailures < UNHEALTHY_CONSECUTIVE_FAILURES) return false;
  if (!health.lastFailureAt) return false;
  const sinceFailure = Date.now() - new Date(health.lastFailureAt).getTime();
  return sinceFailure < UNHEALTHY_COOLDOWN_MS;
}

/**
 * M3-01: some models (Gemini's/Groq's/NVIDIA's newer "thinking"/reasoning
 * variants — confirmed live: gemini-3.6-flash, openai/gpt-oss-120b,
 * nvidia/nemotron-3-super-120b-a12b) spend part of maxTokens on internal
 * reasoning before producing visible text. When maxTokens is small enough
 * that reasoning consumes the whole budget, the provider returns a real
 * HTTP 200 with a genuinely empty content string — previously treated as a
 * successful response, which is exactly the "chat sometimes doesn't
 * respond at all" bug: no error was ever thrown, so the UI just rendered
 * nothing. An empty completion is treated as a failure here so the caller
 * falls through to the next provider/model instead of silently succeeding
 * with nothing to show.
 */
function isEmptyResult(content: string): boolean {
  return content.trim().length === 0;
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
  const deadlineAt = isInteractiveCall(options) ? Date.now() + INTERACTIVE_DEADLINE_MS : null;
  let deadlineHit = false;
  const settings = await loadSettings();
  let pairs = await resolveOrderedPairs(options, settings);
  pairs = await applyBudgetGate(pairs, options.usageContext?.tenantId);
  const prioritized = await prioritizePairs(pairs, !!(options.candidates && options.candidates.length > 0), options.usageContext?.tenantId);
  pairs = prioritized.pairs;

  let lastError: AIProviderError | null = null;

  for (const { providerId, model } of pairs) {
    if (!prioritized.lastResort && isCircuitOpen(options.usageContext?.tenantId, providerId, model)) {
      lastError = new AIProviderError(`${providerId} skipped (circuit open after a hard failure)`, 0, providerId);
      continue;
    }
    if (await isSkippableUnhealthy(providerId, model)) {
      logger.providerWarn(`Skipping ${providerId}/${model} — ${UNHEALTHY_CONSECUTIVE_FAILURES}+ recent consecutive failures, still in cooldown`);
      lastError = new AIProviderError(`${providerId} skipped (recent repeated failures)`, 0, providerId);
      continue;
    }
    const remainingMs = deadlineAt === null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
    if (remainingMs < MIN_ATTEMPT_MS) { deadlineHit = true; break; }
    const provider = getProvider(providerId);
    const start = Date.now();
    try {
      logger.provider(`Trying ${providerId}`, { model });
      const result = await provider.chat(messages, { ...options, model, timeoutMs: Math.min(requestTimeoutFor(options), remainingMs) });
      const latencyMs = Date.now() - start;
      if (isEmptyResult(result.content)) {
        recordHealth({ provider: providerId, modelId: model, success: false, latencyMs, statusCode: 200 });
        logger.providerWarn(`${providerId}/${model} returned an empty completion (likely reasoning tokens exhausted maxTokens) — treating as failure`);
        lastError = new AIProviderError(`${providerId} returned an empty response`, 200, providerId, 'empty_response');
        continue;
      }
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
      tripCircuitIfHardFailure(options.usageContext?.tenantId, providerId, model, lastError.status);
      logger.providerWarn(`${providerId} failed: ${lastError.message}`);
      // M2-02: an IP-level rate limit applies identically to every
      // provider (it's checked before the edge function even looks at
      // which one was requested) — cycling through the rest of the
      // fallback chain would just repeat the same block. Fail fast.
      if (lastError.code === 'rate_limited') break;
      continue;
    }
  }

  if (deadlineHit) throw deadlineError(lastError?.providerId ?? pairs[0]?.providerId ?? 'gemini');
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
  const deadlineAt = isInteractiveCall(options) ? Date.now() + INTERACTIVE_DEADLINE_MS : null;
  let deadlineHit = false;
  const settings = await loadSettings();
  let pairs = await resolveOrderedPairs(options, settings);
  pairs = await applyBudgetGate(pairs, options.usageContext?.tenantId);
  const prioritized = await prioritizePairs(pairs, !!(options.candidates && options.candidates.length > 0), options.usageContext?.tenantId);
  pairs = prioritized.pairs;

  let lastError: AIProviderError | null = null;

  for (const { providerId, model } of pairs) {
    if (!prioritized.lastResort && isCircuitOpen(options.usageContext?.tenantId, providerId, model)) {
      lastError = new AIProviderError(`${providerId} skipped (circuit open after a hard failure)`, 0, providerId);
      continue;
    }
    if (await isSkippableUnhealthy(providerId, model)) {
      logger.providerWarn(`Skipping ${providerId}/${model} — ${UNHEALTHY_CONSECUTIVE_FAILURES}+ recent consecutive failures, still in cooldown`);
      lastError = new AIProviderError(`${providerId} skipped (recent repeated failures)`, 0, providerId);
      continue;
    }
    const remainingMs = deadlineAt === null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
    if (remainingMs < MIN_ATTEMPT_MS) { deadlineHit = true; break; }
    const provider = getProvider(providerId);
    const start = Date.now();
    try {
      logger.provider(`Streaming via ${providerId}`, { model });
      const result = await provider.chatStream(messages, { ...options, model, timeoutMs: Math.min(requestTimeoutFor(options), remainingMs) });
      const latencyMs = Date.now() - start;
      if (isEmptyResult(result.content)) {
        recordHealth({ provider: providerId, modelId: model, success: false, latencyMs, statusCode: 200 });
        logger.providerWarn(`${providerId}/${model} streamed an empty completion (likely reasoning tokens exhausted maxTokens) — treating as failure`);
        lastError = new AIProviderError(`${providerId} returned an empty response`, 200, providerId, 'empty_response');
        continue;
      }
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
      tripCircuitIfHardFailure(options.usageContext?.tenantId, providerId, model, lastError.status);
      logger.providerWarn(`${providerId} stream failed: ${lastError.message}`);
      if (lastError.code === 'rate_limited') break;
      continue;
    }
  }

  if (deadlineHit) throw deadlineError(lastError?.providerId ?? pairs[0]?.providerId ?? 'gemini');
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

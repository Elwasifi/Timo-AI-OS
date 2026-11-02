// web.search — the SERVER-SIDE core (M7-13c-2a-4, quota handling M7-13c-2a-5).
//
// Resolves the Gemini key and model for ONE tenant and runs the grounded search. SERVER ONLY:
//   - the key is read with the service-role client (lib/supabase/serverClient.ts hard-fails in a browser) and
//     never leaves this module — it is not returned, not logged, and is scrubbed from every error text;
//   - callers are (a) POST /api/tools/web-search, for tools running in the browser, and (b) webSearchHandler
//     itself when the executor runs on the server (the mission task queue).
//
// Which key (same rule as chat, supabase/functions/ai-chat loadProviderConfigs + lib/settings/tenantConfiguredProviders
// requiresByok): a CLIENT tenant uses ITS OWN tenant_provider_keys row for 'gemini' (BYOK) and NEVER falls back to the
// global app_settings key; only the grandfathered internal tenant keeps using app_settings. A missing key is a
// ToolNotConfiguredError — a deterministic failure that is not retried.
//
// Which model (M7-13c-2a-5): free-tier Gemini keys have tiny PER-MODEL daily quotas (live, Amro's key: gemini-3.6-flash
// 20 requests/day, gemini-3.1-flash-lite 500/day), and web.search used to burn the 20/day. So the candidates are, in
// order: the model pinned for this key (tenant_provider_keys.model / app_settings.gemini_model), then
// gemini-flash-lite-latest (the model chat already uses on this key), then gemini-3.6-flash — at most TWO attempts per
// call, each model tried once, and a hop happens only when a model is out of quota or unavailable. Quota exhaustion
// (not a per-minute rate limit) is a ToolQuotaExceededError: deterministic, not retried, readable message.

import { ToolNotConfiguredError, ToolQuotaExceededError } from './types';
import { INTERNAL_TENANT_ID } from '@/lib/governance/internalTenant';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** The model chat already uses on this key (500 requests/day on the free tier). NOT verified live for Google Search grounding. */
export const WEB_SEARCH_PRIMARY_MODEL = 'gemini-flash-lite-latest';
/** The previous default; last candidate. */
export const WEB_SEARCH_LAST_MODEL = 'gemini-3.6-flash';
/** Hard cap: never loop, never call more than this many models for one search. */
const MAX_MODEL_ATTEMPTS = 2;

export const WEB_SEARCH_NO_KEY_MESSAGE =
  'web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.';

export interface WebSearchResult {
  results: { title: string; url: string; snippet: string }[];
  query: string;
  count: number;
  summary?: string;
}

interface GeminiConfig {
  apiKey: string;
  /** The model pinned for this key, or null = no preference. */
  pinnedModel: string | null;
}

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: GroundingChunk[] };
  }[];
}

/** Removes the key from any text that might be shown, logged or returned. */
function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}

const nonBlank = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0;

/** The tenant's Gemini key + pinned model, or a ToolNotConfiguredError. A failed READ is a plain (retryable) Error. */
async function resolveGeminiConfig(tenantId: string | null | undefined): Promise<GeminiConfig> {
  if (!tenantId) {
    throw new ToolNotConfiguredError('web.search cannot run without a workspace — none was provided for this call.');
  }
  const { getServiceRoleClient } = await import('@/lib/supabase/serverClient');
  const db = getServiceRoleClient();

  let apiKey: string | null | undefined;
  let model: string | null | undefined;
  if (tenantId === INTERNAL_TENANT_ID) {
    const { data, error } = await db.from('app_settings').select('gemini_api_key, gemini_model').eq('id', 1).maybeSingle();
    if (error) throw new Error(`web.search could not read its configuration (${error.message}).`);
    const row = data as { gemini_api_key?: string | null; gemini_model?: string | null } | null;
    apiKey = row?.gemini_api_key;
    model = row?.gemini_model;
  } else {
    // BYOK — the tenant's own row, no fallback to anyone else's key.
    const { data, error } = await db
      .from('tenant_provider_keys')
      .select('api_key, model')
      .eq('tenant_id', tenantId)
      .eq('provider', 'gemini')
      .maybeSingle();
    if (error) throw new Error(`web.search could not read its configuration (${error.message}).`);
    const row = data as { api_key?: string | null; model?: string | null } | null;
    apiKey = row?.api_key;
    model = row?.model;
  }

  if (!nonBlank(apiKey)) throw new ToolNotConfiguredError(WEB_SEARCH_NO_KEY_MESSAGE);
  return { apiKey: apiKey.trim(), pinnedModel: nonBlank(model) ? model.trim() : null };
}

/** Pinned model first (if any), then the chat model, then the last resort; each model once; at most MAX_MODEL_ATTEMPTS. */
function candidateModels(pinned: string | null): string[] {
  const out: string[] = [];
  for (const m of [pinned, WEB_SEARCH_PRIMARY_MODEL, WEB_SEARCH_LAST_MODEL]) {
    if (m && !out.includes(m)) out.push(m);
  }
  return out.slice(0, MAX_MODEL_ATTEMPTS);
}

// ---- Gemini error bodies -------------------------------------------------------------------------------------------
//
// The real shape of a Gemini error is {"error":{"code":429,"message":"...","status":"RESOURCE_EXHAUSTED","details":[
// {"@type":".../google.rpc.QuotaFailure","violations":[{"quotaId":"...PerDay...","quotaMetric":...}]},
// {"@type":".../google.rpc.RetryInfo","retryDelay":"26s"}]}} — but that is from Google's documented error model and
// Amro's live message, NOT from any fixture in this repo, and the body may arrive truncated or not as JSON at all.
// So everything below is defensive: try JSON, fall back to regexes over the raw text, and never throw.

interface ParsedGeminiError {
  /** Human-readable message: URLs removed, whitespace collapsed, capped. Never raw JSON. */
  message: string;
  status: string;
  quotaIds: string[];
  retryDelaySec: number | null;
}

const stripUrls = (t: string) => t.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

function parseGeminiError(body: string, apiKey: string): ParsedGeminiError {
  let message = '';
  let status = '';
  const quotaIds: string[] = [];
  let retryDelaySec: number | null = null;

  try {
    const parsed: unknown = JSON.parse(body);
    const root = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: Record<string, unknown> } | undefined;
    const err = root?.error;
    if (err && typeof err === 'object') {
      if (typeof err.message === 'string') message = err.message;
      if (typeof err.status === 'string') status = err.status;
      for (const d of Array.isArray(err.details) ? (err.details as Array<Record<string, unknown>>) : []) {
        for (const v of Array.isArray(d?.violations) ? (d.violations as Array<Record<string, unknown>>) : []) {
          if (typeof v?.quotaId === 'string') quotaIds.push(v.quotaId);
        }
        if (typeof d?.retryDelay === 'string') {
          const n = parseFloat(d.retryDelay);
          if (Number.isFinite(n)) retryDelaySec = n;
        }
      }
    }
  } catch {
    // not JSON (or truncated JSON): fall through to the text scan below
  }

  // Text scan: fills in whatever the JSON path did not (truncated bodies, plain-text errors).
  if (!message) message = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(body)?.[1]?.replace(/\\n/g, ' ').replace(/\\"/g, '"') ?? '';
  if (!status) status = /"status"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1] ?? '';
  if (quotaIds.length === 0) {
    const re = /"quotaId"\s*:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) quotaIds.push(m[1]);
  }
  if (retryDelaySec === null) {
    const m = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(body);
    if (m) retryDelaySec = parseFloat(m[1]);
  }
  if (!message) message = body; // plain text: use it, sanitized below

  // Scrub the key BEFORE capping the length, so a cut can never leave a recognisable fragment of it.
  return { message: redact(stripUrls(message), apiKey).slice(0, 200), status, quotaIds, retryDelaySec };
}

/**
 * A 429 is either the account's QUOTA being used up (hours until it resets: do not retry) or a per-minute RATE limit
 * (clears in seconds: retry as before). Order of evidence, strongest first:
 *   1. quota ids from the error details: any "...PerDay..." -> quota; otherwise "...PerMinute..." -> rate limit
 *   2. wording ("per day" / "per minute")
 *   3. a short retryDelay (<= 30 s) -> rate limit
 *   4. wording that says quota / billing / RESOURCE_EXHAUSTED -> quota
 *   5. otherwise -> rate limit (retryable): we only stop retrying when the text clearly says quota.
 */
function isQuotaExhausted(e: ParsedGeminiError): boolean {
  if (e.quotaIds.some((q) => /per[-_ ]?day/i.test(q))) return true;
  if (e.quotaIds.some((q) => /per[-_ ]?minute/i.test(q))) return false;
  const text = `${e.message} ${e.status}`;
  if (/per[-_ ]?day|daily/i.test(text)) return true;
  if (/per[-_ ]?minute|requests per minute|rate[-_ ]?limit/i.test(text)) return false;
  if (e.retryDelaySec !== null && e.retryDelaySec <= 30) return false;
  return /quota|billing|RESOURCE_EXHAUSTED/i.test(text);
}

/**
 * A model that cannot serve this request at all (does not exist / no grounding support) — the next candidate may.
 * Wording-free on purpose: Google's text for "this model can't do google_search" is not known, so ANY 404, and ANY 400
 * that isRejectedKey() has not already claimed as a bad key, counts (the request is well-formed; the model is the
 * variable). Call it only AFTER isRejectedKey().
 */
function isModelUnavailable(status: number): boolean {
  return status === 404 || status === 400;
}

/** Gemini answers a bad key with 400 API_KEY_INVALID as well as 401/403. */
function isRejectedKey(status: number, body: string): boolean {
  return status === 401 || status === 403 || (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body));
}

function quotaMessage(models: string[]): string {
  const which = models.length === 1 ? `model ${models[0]}` : `models ${models.join(' and ')}`;
  return `Gemini's request limit for ${which} was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio.`;
}

type Attempt =
  | { kind: 'ok'; data: GeminiGenerateContentResponse }
  | { kind: 'quota' }
  | { kind: 'model_unavailable'; reason: string };

async function callGemini(apiKey: string, model: string, query: string): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      // The key travels in a header, never in the URL (URLs end up in proxy and server logs).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    });
  } catch (err) {
    throw new Error(redact(`Gemini grounding request failed: ${err instanceof Error ? err.message : String(err)}`, apiKey));
  }

  if (res.ok) return { kind: 'ok', data: (await res.json()) as GeminiGenerateContentResponse };

  const body = await res.text().catch(() => '');
  if (isRejectedKey(res.status, body)) {
    throw new ToolNotConfiguredError(
      `web.search: Gemini rejected this workspace's API key (HTTP ${res.status}) — check or replace it in Settings → AI Providers.`,
    );
  }
  const parsed = parseGeminiError(body, apiKey);
  if (res.status === 429 && isQuotaExhausted(parsed)) return { kind: 'quota' };
  if (isModelUnavailable(res.status)) return { kind: 'model_unavailable', reason: parsed.message || `HTTP ${res.status}` };
  // A per-minute rate limit, 5xx or anything else stays a plain error: transient, retried as before. Only the readable
  // message is shown — never the raw JSON body.
  throw new Error(redact(`Gemini grounding request failed (${res.status}): ${parsed.message || res.statusText}`, apiKey));
}

export async function searchWithTenantKey(
  tenantId: string | null | undefined,
  query: string,
  maxResultsArg?: number,
): Promise<WebSearchResult> {
  const maxResults = typeof maxResultsArg === 'number' ? Math.min(Math.max(maxResultsArg, 1), 20) : 5;
  if (!query || !query.trim()) throw new Error('web.search requires a non-empty query.');

  const { apiKey, pinnedModel } = await resolveGeminiConfig(tenantId);

  const tried: string[] = [];
  const quotaHit: string[] = [];
  let lastUnavailableReason = '';
  let data: GeminiGenerateContentResponse | null = null;
  for (const model of candidateModels(pinnedModel)) {
    tried.push(model);
    const attempt = await callGemini(apiKey, model, query);
    if (attempt.kind === 'ok') { data = attempt.data; break; }
    if (attempt.kind === 'quota') quotaHit.push(model);
    if (attempt.kind === 'model_unavailable') lastUnavailableReason = attempt.reason;
    // quota or unavailable model: hop to the next candidate (each model once, hard-capped).
  }

  if (!data) {
    if (quotaHit.length > 0) throw new ToolQuotaExceededError(quotaMessage(quotaHit));
    throw new ToolNotConfiguredError(
      `web.search: none of the Gemini models tried (${tried.join(', ')}) can run Google Search with this workspace's API key — pin a supported model in Settings → AI Providers.` +
        (lastUnavailableReason ? ` Gemini said: ${lastUnavailableReason}` : ''),
    );
  }

  const candidate = data.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const answerText = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  // Grounding genuinely returning nothing is an honest empty result, not a failure.
  const results = chunks
    .filter((c) => c.web?.uri)
    .slice(0, maxResults)
    .map((c) => ({ title: c.web?.title ?? c.web?.uri ?? 'Untitled', url: c.web!.uri!, snippet: '' }));

  return { results, query, count: results.length, summary: answerText || undefined };
}

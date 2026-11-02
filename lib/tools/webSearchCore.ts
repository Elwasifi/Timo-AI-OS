// web.search — the SERVER-SIDE core (M7-13c-2a-4).
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

import { ToolNotConfiguredError } from './types';
import { INTERNAL_TENANT_ID } from '@/lib/governance/internalTenant';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Same default the chat adapter uses (supabase/functions/ai-chat/adapters/gemini.ts) when no model is pinned. */
const DEFAULT_MODEL = 'gemini-3.6-flash';

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
  model: string;
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

/** The tenant's Gemini key + model, or a ToolNotConfiguredError. A failed READ is a plain (retryable) Error. */
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

  if (!apiKey || !apiKey.trim()) throw new ToolNotConfiguredError(WEB_SEARCH_NO_KEY_MESSAGE);
  return { apiKey: apiKey.trim(), model: (model && model.trim()) || DEFAULT_MODEL };
}

/** Gemini answers a bad key with 400 API_KEY_INVALID as well as 401/403. */
function isRejectedKey(status: number, body: string): boolean {
  return status === 401 || status === 403 || (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body));
}

export async function searchWithTenantKey(
  tenantId: string | null | undefined,
  query: string,
  maxResultsArg?: number,
): Promise<WebSearchResult> {
  const maxResults = typeof maxResultsArg === 'number' ? Math.min(Math.max(maxResultsArg, 1), 20) : 5;
  if (!query || !query.trim()) throw new Error('web.search requires a non-empty query.');

  const { apiKey, model } = await resolveGeminiConfig(tenantId);

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

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (isRejectedKey(res.status, body)) {
      throw new ToolNotConfiguredError(
        `web.search: Gemini rejected this workspace's API key (HTTP ${res.status}) — check or replace it in Settings → AI Providers.`,
      );
    }
    // 429 / 5xx / anything else stays a plain error: transient, retried as before.
    throw new Error(redact(`Gemini grounding request failed (${res.status}): ${body.slice(0, 300) || res.statusText}`, apiKey));
  }

  const data = (await res.json()) as GeminiGenerateContentResponse;
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

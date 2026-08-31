// Real web search handler for the web.search tool (M6-02).
//
// Uses Gemini's native Search Grounding (a request-time tool flag on
// generateContent, not a separate search API/vendor) instead of a new
// third-party search provider — Gemini is already in the provider fallback
// chain with a working rotated key (S0-01), and grounding has a genuinely
// free quota (5,000 grounded queries/month on Gemini 3 models, 1,500/day on
// Gemini 2.5 Flash) with zero new account, key, or billing relationship.
//
// web.search was a placeholder (lib/tools/builtin-tools.ts's
// placeholderHandler) from the moment it was first registered — M5-02 fixed
// the fake-success reporting *around* tool results generally, it never
// touched this handler's actual data source.

import { loadSettings } from '@/lib/settings/settings-service';
import type { ToolHandler } from './types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: GroundingChunk[];
    };
  }[];
}

export const webSearchHandler: ToolHandler = async (args) => {
  const query = args.query as string;
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 20) : 5;

  if (!query || !query.trim()) {
    throw new Error('web.search requires a non-empty query.');
  }

  const settings = await loadSettings();
  const apiKey = settings.gemini_api_key;
  if (!apiKey) {
    // Never fabricate results — an unconfigured key is a real failure,
    // matching the placeholder-handler discipline this replaces (M4-02):
    // throw, don't return a fake/empty "success".
    throw new Error('web.search is not available — no Gemini API key configured (Settings → AI Providers).');
  }

  // Fallback matches whatever this account's key currently supports —
  // confirmed live that gemini-2.0-flash/gemini-2.5-flash are deprecated
  // on this project's key ("no longer available[/to new users]"),
  // gemini-3.6-flash is the one that responds.
  const model = settings.gemini_model || 'gemini-3.6-flash';
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini grounding request failed (${res.status}): ${body.slice(0, 300) || res.statusText}`);
  }

  const data = (await res.json()) as GeminiGenerateContentResponse;
  const candidate = data.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const answerText = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  // Grounding genuinely returning nothing (the model decided a search
  // wasn't warranted, or found nothing) is an honest empty result, not a
  // failure — a real search can legitimately turn up zero sources.
  const results = chunks
    .filter((c) => c.web?.uri)
    .slice(0, maxResults)
    .map((c) => ({
      title: c.web?.title ?? c.web?.uri ?? 'Untitled',
      url: c.web!.uri!,
      snippet: '',
    }));

  return { results, query, count: results.length, summary: answerText || undefined };
};

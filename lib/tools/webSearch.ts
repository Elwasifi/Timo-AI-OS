// Real web search handler for the web.search tool (M6-02).
// Uses the Brave Search API (free tier: 2000 queries/month, no credit card
// required) — key stored in app_settings.brave_search_api_key, following
// the same pattern as every other provider key in this project.
//
// web.search was a placeholder (lib/tools/builtin-tools.ts's
// placeholderHandler) from the moment it was first registered — M5-02 fixed
// the fake-success reporting *around* tool results generally, it never
// touched this handler's actual data source.

import { loadSettings } from '@/lib/settings/settings-service';
import type { ToolHandler } from './types';

interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

export const webSearchHandler: ToolHandler = async (args) => {
  const query = args.query as string;
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 20) : 5;

  if (!query || !query.trim()) {
    throw new Error('web.search requires a non-empty query.');
  }

  const settings = await loadSettings();
  const apiKey = settings.brave_search_api_key;
  if (!apiKey) {
    // Never fabricate results — an unconfigured key is a real failure,
    // matching the placeholder-handler discipline this replaces (M4-02):
    // throw, don't return a fake/empty "success".
    throw new Error(
      'web.search is not configured — no Brave Search API key set. Add one in Settings (free tier at brave.com/search/api) before this tool can run.',
    );
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brave Search API request failed (${res.status}): ${body.slice(0, 300) || res.statusText}`);
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? '',
  }));

  return { results, query, count: results.length };
};

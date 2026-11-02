// web.search handler (M6-02, reworked M7-13c-2a-4).
//
// Uses Gemini's native Search Grounding (see webSearchCore.ts for the call itself). Since M7-13c-2a-4 the
// Gemini key is the TENANT's own (BYOK) and is resolved SERVER-SIDE only:
//   - toolExecutor runs both in the browser (chat) and on the server (mission task queue). In the browser this
//     handler calls POST /api/tools/web-search with the user's session; the key never reaches the browser, which
//     matters all the more because M7-13f will stop members reading tenant_provider_keys.api_key from it.
//   - on the server (no `window`) it calls the same core directly — the tenant id comes from the executor's trusted
//     context, there is no user session to forward.
// Before this, the handler read the single global app_settings row, so a BYOK tenant's search always failed with
// "no Gemini API key configured" (and was retried 3 times).

import { authFetch } from '@/lib/api/authFetch';
import { ToolNotConfiguredError, ToolQuotaExceededError, type ToolHandler } from './types';
import type { WebSearchResult } from './webSearchCore';

export const webSearchHandler: ToolHandler = async (args, context) => {
  const query = args.query as string;
  const maxResults = typeof args.maxResults === 'number' ? args.maxResults : undefined;

  if (!query || !query.trim()) {
    throw new Error('web.search requires a non-empty query.');
  }

  if (typeof window === 'undefined') {
    const { searchWithTenantKey } = await import('./webSearchCore');
    return searchWithTenantKey(context.tenantId, query, maxResults);
  }

  const res = await authFetch('/api/tools/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: context.tenantId, query, maxResults }),
    signal: context.signal,
  });
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: WebSearchResult; error?: { code?: string; message?: string } }
    | null;

  if (res.ok && json?.success && json.data) return json.data;

  const message = json?.error?.message ?? `web.search failed (HTTP ${res.status}).`;
  // The route reports missing/rejected configuration as NOT_CONFIGURED: deterministic, never retried.
  if (json?.error?.code === 'NOT_CONFIGURED') throw new ToolNotConfiguredError(message);
  // ... and an exhausted provider quota as QUOTA_EXCEEDED: also deterministic (M7-13c-2a-5).
  if (json?.error?.code === 'QUOTA_EXCEEDED') throw new ToolQuotaExceededError(message);
  throw new Error(message);
};

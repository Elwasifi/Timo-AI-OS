// n8nClient — the single communication gateway between Temo and n8n.
//
// Every call to n8n goes through this module. It proxies requests to the
// n8n-proxy edge function, which holds the API key server-side and performs
// the actual HTTP call to the n8n REST API. The frontend NEVER has access to
// the n8n API key.
//
// This module is the ONLY entry point the rest of Temo should import. The
// individual service files (workflowService, executionService, etc.) are
// re-exported from here so callers have a single import surface.

import type { ProxyAction, ProxyRequest, ProxyResponse } from './types';

const EDGE_FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/n8n-proxy`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANON_KEY}`,
    'apikey': ANON_KEY,
  };
}

export class N8nProxyError extends Error {
  constructor(message: string, public action: ProxyAction) {
    super(message);
    this.name = 'N8nProxyError';
  }
}

/**
 * Send a request to the n8n-proxy edge function and return typed data.
 * Throws N8nProxyError on any failure (network, n8n API, or config).
 */
export async function proxy<T>(request: ProxyRequest): Promise<T> {
  let res: Response;
  try {
    res = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new N8nProxyError(
      `Could not reach the n8n integration service. ${err instanceof Error ? err.message : ''}`,
      request.action,
    );
  }

  let body: ProxyResponse<T>;
  try {
    body = await res.json() as ProxyResponse<T>;
  } catch {
    throw new N8nProxyError('The n8n integration service returned an invalid response.', request.action);
  }

  if (!body.ok || body.error) {
    throw new N8nProxyError(body.error ?? 'Unknown n8n proxy error.', request.action);
  }

  return body.data as T;
}

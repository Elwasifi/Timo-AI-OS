// M7-13c-2a-4 — server-side web search for tools running in the browser.
//
// POST { tenantId, query, maxResults? }
//   - signed-in user AND a member of that tenant (any role) — otherwise 401 / 403 (the same 403 whether the
//     tenant exists or not, so nothing leaks);
//   - resolves the TENANT's own Gemini key with the service role (lib/tools/webSearchCore.ts) and returns ONLY
//     the search result — never the key, a key fragment or the provider's raw response;
//   - missing/rejected configuration -> 422 NOT_CONFIGURED (deterministic, the tool reports it as not_configured and
//     does not retry); an exhausted provider quota -> 429 QUOTA_EXCEEDED (also not retried: retrying burns more of
//     it); any other upstream problem -> 502 UPSTREAM_ERROR (transient, retried as before).

import { NextResponse } from 'next/server';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';
import { ok, fail, badRequest } from '@/lib/api/response';
import { ToolNotConfiguredError, ToolQuotaExceededError } from '@/lib/tools/types';
import { searchWithTenantKey } from '@/lib/tools/webSearchCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
    const query = typeof body?.query === 'string' ? body.query : '';
    const maxResults = typeof body?.maxResults === 'number' ? body.maxResults : undefined;

    if (!tenantId) return NextResponse.json(badRequest('tenantId is required', start), { status: 400 });
    if (!(await isTenantMember(user.id, tenantId))) {
      return NextResponse.json(fail('FORBIDDEN', 'You do not have access to this workspace', start), { status: 403 });
    }
    if (!query.trim()) return NextResponse.json(badRequest('query is required', start), { status: 400 });

    try {
      return NextResponse.json(ok(await searchWithTenantKey(tenantId, query, maxResults), start));
    } catch (err) {
      if (err instanceof ToolNotConfiguredError) {
        return NextResponse.json(fail('NOT_CONFIGURED', err.message, start), { status: 422 });
      }
      // M7-13c-2a-5: the provider's quota is used up — 429 with its own code (the sentence is already readable).
      if (err instanceof ToolQuotaExceededError) {
        return NextResponse.json(fail('QUOTA_EXCEEDED', err.message, start), { status: 429 });
      }
      // searchWithTenantKey scrubs the key from every message it throws.
      return NextResponse.json(fail('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Search failed', start), { status: 502 });
    }
  } catch {
    return NextResponse.json(fail('INTERNAL_ERROR', 'Search failed', start), { status: 500 });
  }
}

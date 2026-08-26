// Server-side API route authorization — V1 Section 7.
//
// lib/supabase/client.ts's shared client resolves to the SERVICE-ROLE key
// when run server-side (see its comment), which bypasses RLS entirely.
// That is necessary for the queue processor, but it means RLS is no
// longer a backstop for API routes — each route that touches
// tenant-scoped or otherwise sensitive data MUST call requireUser() (and
// requireTenantMember() where relevant) itself. This is the single
// verification helper for all of them; do not re-implement token parsing
// per route.

import { createClient } from '@supabase/supabase-js';

export interface AuthedUser {
  id: string;
  email: string | null;
}

/**
 * Verify the caller's Supabase session from the request's Authorization
 * header (`Bearer <access_token>`, sent by every authenticated fetch()
 * call from the frontend — see lib/api/authFetch.ts). Returns null if
 * missing/invalid — callers should respond 401.
 *
 * Falls back to a `?token=` query parameter for endpoints the browser's
 * native `EventSource` connects to (SSE routes) — `EventSource` cannot set
 * custom request headers, so this is the only way those routes can be
 * authenticated at all. Only use the query-param path for GET/SSE routes,
 * never for anything mutating (query strings end up in server/proxy logs).
 */
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  let token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) {
    try {
      token = new URL(req.url).searchParams.get('token') ?? undefined;
    } catch {
      // req.url may not be absolute in some test contexts — ignore.
    }
  }
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  // A throwaway client scoped to just this token — verifying a JWT does
  // not require service-role privileges.
  const verifier = createClient(url, anonKey);
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

/** Check whether `userId` belongs to `tenantId` (any role). Uses the service-role client since this runs server-side. */
export async function isTenantMember(userId: string, tenantId: string): Promise<boolean> {
  const { getServiceRoleClient } = await import('@/lib/supabase/serverClient');
  const client = getServiceRoleClient();
  const { data } = await client
    .from('tenant_members')
    .select('id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return !!data;
}

// Tenant role enforcement — M7-13c-2a-3.
//
// lib/auth/apiAuth.ts's isTenantMember() answers "does this user belong to this tenant" for ANY
// role. Some actions must not be open to every member: switching the tenant between Demo and
// Live changes whether the AI performs real actions. This is the single server-side helper for
// "must hold at least this role in this tenant".
//
// The role is ALWAYS read from tenant_members (service role, server only) for the verified
// user id — never from the request body, a header or a client-held session claim.

export type TenantRole = 'owner' | 'admin' | 'member';

const RANK: Record<TenantRole, number> = { member: 1, admin: 2, owner: 3 };

export type TenantRoleCheck =
  | { ok: true; role: TenantRole }
  | { ok: false; status: 401 | 403; code: 'UNAUTHORIZED' | 'FORBIDDEN'; message: string; role: TenantRole | null };

/** The caller's role in the tenant, or null when they are not a member (or the row is unreadable/unknown). */
export async function getTenantRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const { getServiceRoleClient } = await import('@/lib/supabase/serverClient');
  const { data } = await getServiceRoleClient()
    .from('tenant_members')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin' || role === 'member' ? role : null;
}

/**
 * Requires `userId` to hold at least `required` in `tenantId`.
 * No user -> 401. Not a member, or a lower role -> 403 (fail-closed: an unreadable or unknown role is a refusal).
 */
export async function requireTenantRole(
  userId: string | null | undefined,
  tenantId: string,
  required: TenantRole,
): Promise<TenantRoleCheck> {
  if (!userId) return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Sign in required', role: null };
  const role = await getTenantRole(userId, tenantId);
  if (!role || RANK[role] < RANK[required]) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: required === 'owner' ? 'Only the account owner can do this' : `This requires the "${required}" role`,
      role,
    };
  }
  return { ok: true, role };
}

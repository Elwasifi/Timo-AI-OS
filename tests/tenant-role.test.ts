// M7-13c-2a-3: requireTenantRole() — the single server-side "must hold at least this role" check.
// The role is read from tenant_members for the VERIFIED user id; nothing the request says can grant it.
// tenant_members is faked in memory (no network, no DB); the helper under test is real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  members: [] as Array<{ tenant_id: string; user_id: string; role: string }>,
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        maybeSingle: async () => {
          h.queries.push({ table, filters: { ...filters } });
          const row = h.members.find((m) => Object.entries(filters).every(([k, v]) => (m as Record<string, unknown>)[k] === v));
          return { data: row ? { role: row.role } : null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { requireTenantRole, getTenantRole } from '@/lib/auth/tenantRole';

const T = 'tenant-1';

beforeEach(() => {
  h.queries.length = 0;
  h.members.length = 0;
  h.members.push(
    { tenant_id: T, user_id: 'u-owner', role: 'owner' },
    { tenant_id: T, user_id: 'u-admin', role: 'admin' },
    { tenant_id: T, user_id: 'u-member', role: 'member' },
    { tenant_id: 'tenant-2', user_id: 'u-other-owner', role: 'owner' },
  );
});

describe('requireTenantRole(…, "owner")', () => {
  it('the owner passes', async () => {
    expect(await requireTenantRole('u-owner', T, 'owner')).toEqual({ ok: true, role: 'owner' });
  });

  it.each([
    ['admin', 'u-admin'],
    ['member', 'u-member'],
    ['non-member of this tenant', 'u-nobody'],
    ['owner of a DIFFERENT tenant', 'u-other-owner'],
  ])('%s -> 403 FORBIDDEN', async (_label, uid) => {
    const r = await requireTenantRole(uid, T, 'owner');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.code).toBe('FORBIDDEN');
      expect(r.message).toMatch(/account owner/i);
    }
  });

  it.each([[null], [undefined], ['']])('no user (%j) -> 401 UNAUTHORIZED, and no database read happens', async (uid) => {
    const r = await requireTenantRole(uid as never, T, 'owner');
    expect(r).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' });
    expect(h.queries).toHaveLength(0);
  });

  it('the role comes from tenant_members for exactly (verified user id, tenant id) — never from anything the caller supplies', async () => {
    await requireTenantRole('u-member', T, 'owner');
    expect(h.queries).toEqual([{ table: 'tenant_members', filters: { user_id: 'u-member', tenant_id: T } }]);
  });

  it('an unknown/garbage role value in the table is a refusal (fail-closed)', async () => {
    h.members.push({ tenant_id: T, user_id: 'u-weird', role: 'superuser' });
    expect((await requireTenantRole('u-weird', T, 'owner')).ok).toBe(false);
    expect(await getTenantRole('u-weird', T)).toBeNull();
  });
});

describe('role ranking for other required roles', () => {
  it('admin requirement: owner and admin pass, member fails', async () => {
    expect((await requireTenantRole('u-owner', T, 'admin')).ok).toBe(true);
    expect((await requireTenantRole('u-admin', T, 'admin')).ok).toBe(true);
    expect((await requireTenantRole('u-member', T, 'admin')).ok).toBe(false);
  });
  it('member requirement: any member passes, a stranger fails', async () => {
    expect((await requireTenantRole('u-member', T, 'member')).ok).toBe(true);
    expect((await requireTenantRole('u-nobody', T, 'member')).ok).toBe(false);
  });
});

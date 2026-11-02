// M7-13c-2a-3: who may change a tenant's execution mode (Demo = 'sandbox' / Live), enforced by the SERVER.
//   - POST /api/tenants/[id]/execution-mode : owner only; Demo immediate; Live needs confirm "LIVE" + audit row
//   - POST /api/tenants/[id]/request-mode-change and the mode_change branch of POST /api/approvals/[id]/confirm
//     now also require the owner (before: any tenant member could request AND approve a switch to Live).
// Real route handlers, real requireTenantRole and real setTenantExecutionMode; the authenticated user,
// the in-memory tables and the approvals store are stubbed (no network, no DB).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  members: [] as Array<{ tenant_id: string; user_id: string; role: string }>,
  tenants: {} as Record<string, string>,
  tenantWrites: [] as Array<{ id: string; mode: string }>,
  failTenantUpdate: false,
  approvalsCreated: [] as Array<Record<string, any>>,
  approvalsResolved: [] as Array<{ id: string; decision: string; by: string }>,
  failRequestApproval: false,
  existingApproval: null as Record<string, any> | null,
  callOrder: [] as string[],
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));

vi.mock('@/lib/supabase/serverClient', () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q: any = {
        select: () => q,
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        maybeSingle: async () => {
          if (table === 'tenant_members') {
            const row = h.members.find((m) => Object.entries(filters).every(([k, v]) => (m as Record<string, unknown>)[k] === v));
            return { data: row ? { role: row.role, id: 'm' } : null, error: null };
          }
          if (table === 'tenants' && patch) {
            if (h.failTenantUpdate || !(filters.id as string in h.tenants)) return { data: null, error: h.failTenantUpdate ? { message: 'boom' } : null };
            h.tenants[filters.id as string] = patch.execution_mode as string;
            h.tenantWrites.push({ id: filters.id as string, mode: patch.execution_mode as string });
            h.callOrder.push('write:' + patch.execution_mode);
            return { data: { id: filters.id }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  }),
}));

vi.mock('@/lib/auth/apiAuth', () => ({
  requireUser: vi.fn(async (req: Request) => {
    const t = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    return t ? { id: t, email: `${t}@example.com` } : null;
  }),
  isTenantMember: vi.fn(async (userId: string, tenantId: string) => h.members.some((m) => m.user_id === userId && m.tenant_id === tenantId)),
}));

vi.mock('@/lib/governance/approvals', () => ({
  requestApproval: vi.fn(async (input: Record<string, any>) => {
    if (h.failRequestApproval) return null;
    h.approvalsCreated.push(input);
    h.callOrder.push('approval:create');
    return { id: 'appr-1', ...input };
  }),
  resolveApproval: vi.fn(async (id: string, decision: string, by: string) => {
    h.approvalsResolved.push({ id, decision, by });
    h.callOrder.push('approval:resolve:' + decision);
    return { ...(h.existingApproval ?? { tenantId: 'T', type: 'mode_change', payload: {} }), id, status: decision, resolvedBy: by };
  }),
  getApproval: vi.fn(async () => h.existingApproval),
}));

import { POST as executionModePOST } from '@/app/api/tenants/[id]/execution-mode/route';
import { POST as requestModeChangePOST } from '@/app/api/tenants/[id]/request-mode-change/route';
import { POST as confirmPOST } from '@/app/api/approvals/[id]/confirm/route';

const T = 'tenant-T';
const req = (user: string | null, body: unknown) =>
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${user}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const toggle = (user: string | null, body: unknown, tenant = T) => executionModePOST(req(user, body), { params: { id: tenant } });

beforeEach(() => {
  h.members = [
    { tenant_id: T, user_id: 'u-owner', role: 'owner' },
    { tenant_id: T, user_id: 'u-admin', role: 'admin' },
    { tenant_id: T, user_id: 'u-member', role: 'member' },
    { tenant_id: 'tenant-U', user_id: 'u-other-owner', role: 'owner' },
  ];
  h.tenants = { [T]: 'sandbox', 'tenant-U': 'sandbox' };
  h.tenantWrites = []; h.approvalsCreated = []; h.approvalsResolved = []; h.callOrder = [];
  h.failTenantUpdate = false; h.failRequestApproval = false; h.existingApproval = null;
});

describe('POST /api/tenants/[id]/execution-mode — authorization matrix', () => {
  const LIVE = { mode: 'live', confirm: 'LIVE' };

  it.each([
    ['sandbox', { mode: 'sandbox' }],
    ['live', LIVE],
  ])('OWNER -> 200 and the response returns the resulting mode (%s)', async (mode, body) => {
    const res = await toggle('u-owner', body);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ mode });
    expect(h.tenants[T]).toBe(mode);
  });

  it.each([
    ['admin', 'u-admin', 403],
    ['member', 'u-member', 403],
    ['non-member (owner of another tenant)', 'u-other-owner', 403],
    ['unknown user', 'u-nobody', 403],
    ['anonymous', null, 401],
  ])('%s -> %i, nothing written, no audit row', async (_label, user, status) => {
    for (const body of [{ mode: 'sandbox' }, LIVE]) {
      const res = await toggle(user as string | null, body);
      expect(res.status).toBe(status);
      expect((await res.json()).success).toBe(false);
    }
    expect(h.tenantWrites).toHaveLength(0);
    expect(h.approvalsCreated).toHaveLength(0);
    expect(h.tenants[T]).toBe('sandbox');
  });

  it('a role claimed in the request body is ignored (a member cannot promote themselves)', async () => {
    const res = await toggle('u-member', { mode: 'sandbox', role: 'owner', userRole: 'owner' });
    expect(res.status).toBe(403);
    expect(h.tenantWrites).toHaveLength(0);
  });

  it('being owner of ANOTHER tenant gives no rights here (the tenant is taken from the URL, role looked up per tenant)', async () => {
    const res = await toggle('u-other-owner', LIVE, T);
    expect(res.status).toBe(403);
    expect(h.tenants['tenant-U']).toBe('sandbox');
    expect(h.tenants[T]).toBe('sandbox');
  });

  it('authorization is checked BEFORE the body: a non-owner with an invalid body gets 403, not 400', async () => {
    expect((await toggle('u-member', { mode: 'bogus' })).status).toBe(403);
  });
});

describe('POST /api/tenants/[id]/execution-mode — validation and behaviour (as the owner)', () => {
  it('live WITHOUT confirm -> 400 and nothing happens', async () => {
    const res = await toggle('u-owner', { mode: 'live' });
    expect(res.status).toBe(400);
    expect(h.tenantWrites).toHaveLength(0);
    expect(h.approvalsCreated).toHaveLength(0);
  });

  it.each(['live', 'Live', ' LIVE', 'LIVE ', 'yes', '', null, 1, true])('live with wrong confirm %j -> 400', async (confirm) => {
    const res = await toggle('u-owner', { mode: 'live', confirm });
    expect(res.status).toBe(400);
    expect(h.tenantWrites).toHaveLength(0);
  });

  it.each(['simulation', 'bogus', '', null, undefined, 42, ['live']])('invalid mode %j -> 400 ("simulation" is not togglable here)', async (mode) => {
    const res = await toggle('u-owner', { mode, confirm: 'LIVE' });
    expect(res.status).toBe(400);
    expect(h.tenantWrites).toHaveLength(0);
  });

  it('missing / non-JSON body -> 400', async () => {
    expect((await executionModePOST(req('u-owner', undefined), { params: { id: T } })).status).toBe(400);
  });

  it('Demo (sandbox) is idempotent: switching twice succeeds both times and leaves sandbox; no audit row is needed for the safe direction', async () => {
    h.tenants[T] = 'live';
    const a = await toggle('u-owner', { mode: 'sandbox' });
    const b = await toggle('u-owner', { mode: 'sandbox' });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(h.tenants[T]).toBe('sandbox');
    expect(h.approvalsCreated).toHaveLength(0);
  });

  it('Demo also takes a tenant that is currently in simulation back to sandbox', async () => {
    h.tenants[T] = 'simulation';
    expect((await toggle('u-owner', { mode: 'sandbox' })).status).toBe(200);
    expect(h.tenants[T]).toBe('sandbox');
  });

  it('Live leaves an AUDIT TRAIL first: an approved mode_change row, attributed to the owner and flagged ownerSelfConfirmed; only then is the mode written', async () => {
    const res = await toggle('u-owner', { mode: 'live', confirm: 'LIVE' });
    expect(res.status).toBe(200);
    expect(h.approvalsCreated).toHaveLength(1);
    expect(h.approvalsCreated[0]).toMatchObject({
      tenantId: T, type: 'mode_change', requestedBy: 'u-owner',
      payload: { tenantId: T, newMode: 'live', ownerSelfConfirmed: true },
    });
    expect(h.approvalsResolved).toEqual([{ id: 'appr-1', decision: 'approved', by: 'u-owner' }]);
    expect(h.callOrder).toEqual(['approval:create', 'approval:resolve:approved', 'write:live']);
  });

  it('if the audit row cannot be written the switch does NOT happen (fail-closed) -> 500', async () => {
    h.failRequestApproval = true;
    const res = await toggle('u-owner', { mode: 'live', confirm: 'LIVE' });
    expect(res.status).toBe(500);
    expect(h.tenantWrites).toHaveLength(0);
    expect(h.tenants[T]).toBe('sandbox');
  });

  it('if the write fails the route says so honestly (500), it does not report the new mode', async () => {
    h.failTenantUpdate = true;
    const res = await toggle('u-owner', { mode: 'sandbox' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.data).toBeNull();
  });

  it('a write that matches no tenant row is a failure, not a success', async () => {
    h.members.push({ tenant_id: 'ghost', user_id: 'u-owner', role: 'owner' }); // owner of a tenant row that does not exist
    const res = await toggle('u-owner', { mode: 'sandbox' }, 'ghost');
    expect(res.status).toBe(500);
  });
});

describe('request-mode-change is now owner-only', () => {
  const call = (user: string | null, body: unknown = { mode: 'live' }, tenant = T) => requestModeChangePOST(req(user, body), { params: { id: tenant } });

  it('owner -> 200 and a pending mode_change approval is created (existing behaviour kept)', async () => {
    const res = await call('u-owner');
    expect(res.status).toBe(200);
    expect(h.approvalsCreated).toHaveLength(1);
    expect(h.approvalsCreated[0]).toMatchObject({ type: 'mode_change', tenantId: T, requestedBy: 'u-owner' });
  });

  it.each([['member', 'u-member'], ['admin', 'u-admin']])('%s -> 403 and no approval is created (before: any member could request Live)', async (_l, uid) => {
    const res = await call(uid);
    expect(res.status).toBe(403);
    expect(h.approvalsCreated).toHaveLength(0);
  });

  it('non-member -> 404 (unchanged: no tenant existence leak), anonymous -> 401 (unchanged)', async () => {
    expect((await call('u-other-owner')).status).toBe(404);
    expect((await call(null)).status).toBe(401);
  });

  it('only "live" can still be requested (400 otherwise, unchanged)', async () => {
    expect((await call('u-owner', { mode: 'sandbox' })).status).toBe(400);
  });
});

describe('confirm: a mode_change approval is an owner decision', () => {
  const pending = (over: Record<string, any> = {}) => ({
    id: 'appr-9', tenantId: T, type: 'mode_change', status: 'pending', taskId: null,
    payload: { tenantId: T, newMode: 'live' }, ...over,
  });
  const confirm = (user: string | null, decision: string) => confirmPOST(req(user, { decision }), { params: { id: 'appr-9' } });

  it.each([['member', 'u-member'], ['admin', 'u-admin']])('%s approving -> 403, the approval stays pending (resolveApproval never called), no mode write', async (_l, uid) => {
    h.existingApproval = pending();
    const res = await confirm(uid, 'approved');
    expect(res.status).toBe(403);
    expect(h.approvalsResolved).toHaveLength(0);
    expect(h.tenantWrites).toHaveLength(0);
  });

  it('a member REJECTING a mode_change is also refused', async () => {
    h.existingApproval = pending();
    expect((await confirm('u-member', 'rejected')).status).toBe(403);
    expect(h.approvalsResolved).toHaveLength(0);
  });

  it('owner approving -> 200, resolved, and the tenant is switched to live', async () => {
    h.existingApproval = pending();
    const res = await confirm('u-owner', 'approved');
    expect(res.status).toBe(200);
    expect(h.approvalsResolved).toEqual([{ id: 'appr-9', decision: 'approved', by: 'u-owner' }]);
    expect(h.tenants[T]).toBe('live');
  });

  it('owner rejecting -> resolved as rejected, mode untouched', async () => {
    h.existingApproval = pending();
    expect((await confirm('u-owner', 'rejected')).status).toBe(200);
    expect(h.tenantWrites).toHaveLength(0);
  });

  it('a mode_change whose payload names a DIFFERENT tenant never switches that other tenant', async () => {
    h.existingApproval = pending({ payload: { tenantId: 'tenant-U', newMode: 'live' } });
    const res = await confirm('u-owner', 'approved');
    expect(res.status).toBe(200);
    expect(h.tenants['tenant-U']).toBe('sandbox');
    expect(h.tenantWrites).toHaveLength(0);
  });

  it('other approval types are unaffected: a plain member can still resolve a non-mode_change approval', async () => {
    h.existingApproval = pending({ type: 'spend', payload: {} });
    const res = await confirm('u-member', 'approved');
    expect(res.status).toBe(200);
    expect(h.approvalsResolved).toEqual([{ id: 'appr-9', decision: 'approved', by: 'u-member' }]);
  });
});

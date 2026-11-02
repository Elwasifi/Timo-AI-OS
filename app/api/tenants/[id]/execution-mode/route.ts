// M7-13c-2a-3 — the Owner's Demo / Live toggle.
//
// POST { mode: 'sandbox' | 'live', confirm?: 'LIVE' }
//   - the caller must be signed in AND hold the 'owner' role in this tenant (read from
//     tenant_members server-side — the request cannot claim a role). The UI hides the toggle from
//     everyone else, but THIS is the gate.
//   - 'sandbox' (Demo) is the safe direction: applied immediately, idempotent.
//   - 'live' needs body.confirm === 'LIVE' (the UI makes the Owner type it). It also leaves a trace:
//     an approval_requests row of type 'mode_change', approved by the same Owner and flagged
//     ownerSelfConfirmed — so the switch is auditable like every other mode change — and only then
//     is the mode applied.
//   - 'simulation' is a valid stored mode but is not togglable here; anything else is a 400.
// The write itself goes through setTenantExecutionMode(): service role, server only (browser UPDATE on
// tenants was closed by the 20261102120000 migration).

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/apiAuth';
import { requireTenantRole } from '@/lib/auth/tenantRole';
import { ok, fail, badRequest, internalError } from '@/lib/api/response';
import { requestApproval, resolveApproval } from '@/lib/governance/approvals';
import { setTenantExecutionMode } from '@/lib/governance/executionMode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const tenantId = params.id;
    const roleCheck = await requireTenantRole(user.id, tenantId, 'owner');
    if (!roleCheck.ok) {
      return NextResponse.json(fail(roleCheck.code, roleCheck.message, start), { status: roleCheck.status });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode;
    if (mode !== 'sandbox' && mode !== 'live') {
      return NextResponse.json(badRequest('mode must be "sandbox" (Demo) or "live"', start), { status: 400 });
    }

    if (mode === 'live') {
      if (body?.confirm !== 'LIVE') {
        return NextResponse.json(badRequest('Switching to Live requires confirm: "LIVE"', start), { status: 400 });
      }

      // Audit trace first. If it cannot be written, the switch does not happen (fail-closed).
      const approval = await requestApproval({
        tenantId,
        type: 'mode_change',
        title: 'Owner switched tenant execution mode to Live',
        detail: `${user.email ?? user.id} (owner) confirmed with "LIVE" and switched tenant ${tenantId} to Live (real external side effects).`,
        payload: { tenantId, newMode: 'live', ownerSelfConfirmed: true },
        requestedBy: user.id,
      });
      const resolved = approval ? await resolveApproval(approval.id, 'approved', user.id) : null;
      if (!approval || !resolved) {
        return NextResponse.json(internalError('Could not record the audit trail for this switch, so the mode was NOT changed', start), { status: 500 });
      }
    }

    const applied = await setTenantExecutionMode(tenantId, mode);
    if (!applied) {
      return NextResponse.json(internalError('The execution mode could not be changed', start), { status: 500 });
    }
    return NextResponse.json(ok({ mode }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to change execution mode', start, { error: String(err) }), { status: 500 });
  }
}

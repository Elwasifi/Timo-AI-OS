// M7-05 — requests a tenant's execution_mode switch to 'live'.
//
// Per the ticket: "switching to Live requires a separate, explicit
// approval (reuse the M7-04 approval-gate mechanism for this transition)."
// This route only ever creates the pending approval_requests row (type
// 'mode_change') — the actual tenants.execution_mode UPDATE happens
// exclusively in app/api/approvals/[id]/confirm/route.ts's mode_change
// branch, on approval, never here.

import { NextResponse } from 'next/server';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';
import { ok, fail, badRequest } from '@/lib/api/response';
import { requestApproval } from '@/lib/governance/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const tenantId = params.id;
    if (!(await isTenantMember(user.id, tenantId))) {
      return NextResponse.json(fail('NOT_FOUND', 'Tenant not found', start), { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedMode = body?.mode;
    if (requestedMode !== 'live') {
      // Switching TO sandbox/simulation is always safe and needs no
      // approval — only the switch INTO 'live' does (per the ticket).
      return NextResponse.json(badRequest('mode must be "live" — sandbox/simulation require no approval', start), { status: 400 });
    }

    const approval = await requestApproval({
      tenantId,
      type: 'mode_change',
      title: 'Approve: switch tenant execution mode to Live',
      detail: `${user.email ?? user.id} requested tenant ${tenantId} switch its default execution mode to Live (real external side effects).`,
      payload: { tenantId, newMode: 'live' },
      requestedBy: user.id,
    });

    return NextResponse.json(ok({ approval }, start));
  } catch (err) {
    return NextResponse.json(fail('INTERNAL_ERROR', 'Failed to request mode change', start, { error: String(err) }), { status: 500 });
  }
}

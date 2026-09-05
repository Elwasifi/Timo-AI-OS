// M7-04 — General confirmation/approval gate.
//
// Single, unified confirm endpoint for every approval_requests row,
// regardless of what created it (a gated mission-task tool call, a
// gated chat tool call, or agent deletion's hand-rolled destructive_action
// approval). Replaces app/settings/page.tsx's ApprovalsSection calling
// resolveApproval() directly from the browser — that pattern is preserved
// for the pure resolve (still just a DB update under RLS), but the
// follow-up action on approval now has one server-authoritative home
// instead of being duplicated between this route and any future UI
// surface that also needs to confirm an approval:
//
//   - Mission-task-originated (approval.taskId set): resolveApproval()
//     itself (lib/governance/approvals.ts) already flips the task back to
//     'ready' (approved) or fails it directly (rejected) — nothing further
//     needed here.
//   - Chat-originated (approval.taskId is null, type === 'tool_execution',
//     payload carries the real toolId/agentId/arguments): chat has no
//     turn-state to resume into (lib/swarm/agentLoop.ts's
//     AgentLoopContext comment), so approval here means "run that one
//     specific call now" rather than resuming a conversation. Must happen
//     server-side (toolExecutor.execute() runs real tool handlers with
//     real credentials/integrations) — this is why this route exists
//     rather than the browser calling resolveApproval() and stopping
//     there.
//   - Everything else (agent deletion, spend/publish approvals): just the
//     resolve, unchanged from today's behavior.

import { NextResponse } from 'next/server';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';
import { ok, fail, notFound, badRequest, internalError } from '@/lib/api/response';
import { getApproval, resolveApproval } from '@/lib/governance/approvals';
import { toolExecutor } from '@/lib/tools/executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const decision = body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      return NextResponse.json(badRequest('decision must be "approved" or "rejected"', start), { status: 400 });
    }

    const existing = await getApproval(params.id);
    if (!existing) return NextResponse.json(notFound('Approval not found', start), { status: 404 });

    // Same RLS shape approval_requests itself uses (tenant_id IS NULL OR
    // is_tenant_member(tenant_id)) — this route runs with the service-role
    // client server-side (V1 security posture), so RLS is not a backstop
    // here and this check must happen explicitly.
    if (existing.tenantId && !(await isTenantMember(user.id, existing.tenantId))) {
      return NextResponse.json(notFound('Approval not found', start), { status: 404 });
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(badRequest(`This approval was already ${existing.status}`, start), { status: 409 });
    }

    const resolved = await resolveApproval(params.id, decision, user.id);
    if (!resolved) return NextResponse.json(internalError('Failed to resolve approval', start), { status: 500 });

    // Chat-originated: no taskId to resume, so approval means "run this
    // one call now." Rejection needs no further action — there is nothing
    // to execute and nothing to resume, unlike the mission-task path.
    if (decision === 'approved' && !resolved.taskId && resolved.type === 'tool_execution') {
      const { toolId, agentId, arguments: args } = resolved.payload as {
        toolId?: string;
        agentId?: string;
        arguments?: Record<string, unknown>;
      };
      if (toolId && agentId) {
        const toolResult = await toolExecutor.execute({
          id: `approved-${resolved.id}`,
          toolId,
          agentId,
          arguments: args ?? {},
          tenantId: resolved.tenantId,
          approvedApprovalId: resolved.id,
        });
        return NextResponse.json(ok({ approval: resolved, toolResult }, start));
      }
    }

    return NextResponse.json(ok({ approval: resolved }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to confirm approval', start, { error: String(err) }), { status: 500 });
  }
}

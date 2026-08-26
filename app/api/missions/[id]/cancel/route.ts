import { NextRequest, NextResponse } from 'next/server';
import { getMission } from '@/lib/swarm/missionService';
import { cancelMission } from '@/lib/swarm/missionEngine';
import { ok, fail, notFound, badRequest, internalError } from '@/lib/api/response';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// User-initiated mission cancellation — see lib/swarm/missionEngine.ts's
// cancelMission() for the cooperative-cancellation semantics. Same
// tenant-membership check as GET /api/missions/[id] (missionService.ts's
// client is service-role server-side, so RLS is not a backstop here).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const id = params.id;
    if (!id) return NextResponse.json(badRequest('Mission ID required', start), { status: 400 });

    const mission = await getMission(id);
    if (!mission) return NextResponse.json(notFound('Mission not found', start), { status: 404 });
    if (!(await isTenantMember(user.id, mission.tenantId))) {
      return NextResponse.json(notFound('Mission not found', start), { status: 404 });
    }

    const result = await cancelMission(id, mission.tenantId, 'Cancelled by user');
    if (!result.success) {
      return NextResponse.json(badRequest(result.error ?? 'Cancel failed', start), { status: 400 });
    }

    return NextResponse.json(ok({ id, cancelled: true }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to cancel mission', start, { error: String(err) }), { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getMission, getTimeline } from '@/lib/swarm/missionService';
import { ok, fail, notFound, badRequest, internalError } from '@/lib/api/response';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const id = params.id;
    if (!id) return NextResponse.json(badRequest('Mission ID required', start), { status: 400 });

    // Same tenant-membership check as /api/missions/[id] — this route's
    // missionService.ts client is service-role server-side, so RLS does not
    // backstop it; without this, any authenticated user could read any
    // tenant's mission timeline by guessing/enumerating a mission ID.
    const mission = await getMission(id);
    if (!mission) return NextResponse.json(notFound('Mission not found', start), { status: 404 });
    if (!(await isTenantMember(user.id, mission.tenantId))) {
      return NextResponse.json(notFound('Mission not found', start), { status: 404 });
    }

    const timeline = await getTimeline(id);
    if (timeline.length === 0) {
      // Could be a valid mission with no events yet, or a bad ID
      return NextResponse.json(ok(timeline, start, { missionId: id, count: 0 }));
    }

    return NextResponse.json(ok(timeline, start, { missionId: id, count: timeline.length }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch mission timeline', start, { error: String(err) }), { status: 500 });
  }
}

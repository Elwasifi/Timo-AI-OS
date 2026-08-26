import { NextRequest, NextResponse } from 'next/server';
import { getTaskQueue, getTaskQueueSummary } from '@/lib/dashboard/dashboardService';
import { getMission } from '@/lib/swarm/missionService';
import { ok, fail, notFound, internalError } from '@/lib/api/response';
import { requireUser, isTenantMember, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const url = new URL(req.url);
    const missionId = url.searchParams.get('missionId') ?? undefined;

    // M1-06: when a specific missionId is requested, verify the caller
    // actually belongs to that mission's tenant before returning its tasks
    // — same IDOR class already fixed for /api/missions/[id]/timeline.
    if (missionId) {
      const mission = await getMission(missionId);
      if (!mission || !(await isTenantMember(user.id, mission.tenantId))) {
        return NextResponse.json(notFound('Mission not found', start), { status: 404 });
      }
    }

    // M2-01: the no-missionId (current-mission) case is now scoped too —
    // getTaskQueue()/getTaskQueueSummary() redact the current mission if
    // it doesn't belong to the caller's tenant.
    const { tenantId, forbidden } = await getCallerTenantId(user.id, url.searchParams.get('tenantId'));
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });

    const [tasks, summary] = await Promise.all([
      getTaskQueue(missionId, tenantId),
      getTaskQueueSummary(tenantId),
    ]);

    return NextResponse.json(ok({ tasks, summary }, start, { missionId: missionId ?? 'current' }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch task queue', start, { error: String(err) }), { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTaskQueue, getTaskQueueSummary } from '@/lib/dashboard/dashboardService';
import { getMission } from '@/lib/swarm/missionService';
import { ok, fail, notFound, internalError } from '@/lib/api/response';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';

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
    // — same IDOR class already fixed for /api/missions/[id]/timeline. The
    // no-missionId (global queue) case is unchanged: it's an aggregate
    // operational view, not a per-record lookup by attacker-controlled ID.
    if (missionId) {
      const mission = await getMission(missionId);
      if (!mission || !(await isTenantMember(user.id, mission.tenantId))) {
        return NextResponse.json(notFound('Mission not found', start), { status: 404 });
      }
    }

    const [tasks, summary] = await Promise.all([
      getTaskQueue(missionId),
      getTaskQueueSummary(),
    ]);

    return NextResponse.json(ok({ tasks, summary }, start, { missionId: missionId ?? 'current' }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch task queue', start, { error: String(err) }), { status: 500 });
  }
}

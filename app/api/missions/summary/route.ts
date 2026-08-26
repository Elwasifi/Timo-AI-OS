import { NextRequest, NextResponse } from 'next/server';
import { getMissionSummary, getRecentMissions, getCurrentActiveMission } from '@/lib/dashboard/dashboardService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const [summary, recent, active] = await Promise.all([
      getMissionSummary(),
      getRecentMissions(10),
      getCurrentActiveMission(),
    ]);
    return NextResponse.json(ok({ summary, recentMissions: recent, activeMission: active }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch mission summary', start, { error: String(err) }), { status: 500 });
  }
}

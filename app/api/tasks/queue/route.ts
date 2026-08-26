import { NextRequest, NextResponse } from 'next/server';
import { getTaskQueue, getTaskQueueSummary } from '@/lib/dashboard/dashboardService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const url = new URL(req.url);
    const missionId = url.searchParams.get('missionId') ?? undefined;

    const [tasks, summary] = await Promise.all([
      getTaskQueue(missionId),
      getTaskQueueSummary(),
    ]);

    return NextResponse.json(ok({ tasks, summary }, start, { missionId: missionId ?? 'current' }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch task queue', start, { error: String(err) }), { status: 500 });
  }
}

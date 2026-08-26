import { NextRequest, NextResponse } from 'next/server';
import { getReadyTasks } from '@/lib/swarm/missionService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const { tenantId, forbidden } = await getCallerTenantId(user.id, new URL(req.url).searchParams.get('tenantId'));
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });

    const tasks = await getReadyTasks(tenantId);
    return NextResponse.json(ok(tasks, start, { count: tasks.length }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch active tasks', start, { error: String(err) }), { status: 500 });
  }
}

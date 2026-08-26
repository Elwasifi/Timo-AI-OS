import { NextRequest, NextResponse } from 'next/server';
import { getSystemStats, getExecutionStats } from '@/lib/dashboard/dashboardService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    // M2-01: mission/task counts are tenant-scoped; agent counts stay
    // global (shared workforce by design).
    const { tenantId, forbidden } = await getCallerTenantId(user.id, new URL(req.url).searchParams.get('tenantId'));
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });

    const [system, execution] = await Promise.all([
      getSystemStats(tenantId),
      getExecutionStats(tenantId),
    ]);
    return NextResponse.json(ok({ system, execution }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch dashboard statistics', start, { error: String(err) }), { status: 500 });
  }
}

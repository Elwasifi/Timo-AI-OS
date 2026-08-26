import { NextRequest, NextResponse } from 'next/server';
import { getMemoryStats } from '@/lib/dashboard/dashboardService';
import { getMemoryHealth } from '@/lib/dashboard/healthService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    // M2-01: `stats` (total/byType) is tenant-scoped — memories has a real
    // tenant_id. `health` stays a global infra check (aggregate counts
    // only, no per-tenant content — documented global-by-design).
    const { tenantId, forbidden } = await getCallerTenantId(user.id, new URL(req.url).searchParams.get('tenantId'));
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });

    const [stats, health] = await Promise.all([
      getMemoryStats(tenantId),
      getMemoryHealth(),
    ]);
    return NextResponse.json(ok({ stats, health }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch memory statistics', start, { error: String(err) }), { status: 500 });
  }
}

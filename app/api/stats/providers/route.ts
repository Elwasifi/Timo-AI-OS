import { NextRequest, NextResponse } from 'next/server';
import { getProviderStats } from '@/lib/dashboard/dashboardService';
import { getProviderHealth } from '@/lib/dashboard/healthService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    // M2-01: usage counts are tenant-scoped (usage_ledger has tenant_id);
    // provider config (hasKey/model/active) stays global — a single shared
    // app_settings row today, not per-tenant credentials.
    const { tenantId, forbidden } = await getCallerTenantId(user.id, new URL(req.url).searchParams.get('tenantId'));
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });

    const [stats, health] = await Promise.all([
      getProviderStats(tenantId),
      getProviderHealth(),
    ]);
    return NextResponse.json(ok({ stats, health }, start, { count: stats.length }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch provider statistics', start, { error: String(err) }), { status: 500 });
  }
}

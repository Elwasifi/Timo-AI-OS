import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeActivity, getRuntimeActivityForTenant } from '@/lib/swarm/runtimeStore';
import { ok, fail, badRequest, internalError } from '@/lib/api/response';
import { requireUser, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '30', 10) || 30, 1), 100);

    // M2-01: rows tied to a mission the caller doesn't own are filtered out
    // — see runtimeStore.ts's getRuntimeActivityForTenant().
    const { tenantId, forbidden } = await getCallerTenantId(user.id, url.searchParams.get('tenantId'));
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });

    const data = tenantId ? await getRuntimeActivityForTenant(tenantId, limit) : await getRuntimeActivity(limit);
    return NextResponse.json(ok(data, start, { count: data.length, limit }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch runtime activity', start, { error: String(err) }), { status: 500 });
  }
}

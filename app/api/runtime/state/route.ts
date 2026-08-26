import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeState, getRuntimeStateForTenant } from '@/lib/swarm/runtimeStore';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser, getCallerTenantId } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    // M2-01: mission-specific fields are redacted if the current mission
    // isn't the caller's — see runtimeStore.ts's getRuntimeStateForTenant().
    const requestedTenantId = new URL(req.url).searchParams.get('tenantId');
    const { tenantId, forbidden, ambiguous } = await getCallerTenantId(user.id, requestedTenantId);
    if (forbidden) return NextResponse.json(fail('FORBIDDEN', 'Not a member of that tenant', start), { status: 403 });
    if (ambiguous) return NextResponse.json(fail('BAD_REQUEST', 'You belong to multiple tenants — pass ?tenantId= explicitly', start), { status: 400 });

    const data = tenantId ? await getRuntimeStateForTenant(tenantId) : await getRuntimeState();
    return NextResponse.json(ok(data, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch runtime state', start, { error: String(err) }), { status: 500 });
  }
}

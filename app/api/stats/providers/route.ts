import { NextRequest, NextResponse } from 'next/server';
import { getProviderStats } from '@/lib/dashboard/dashboardService';
import { getProviderHealth } from '@/lib/dashboard/healthService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const [stats, health] = await Promise.all([
      getProviderStats(),
      getProviderHealth(),
    ]);
    return NextResponse.json(ok({ stats, health }, start, { count: stats.length }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch provider statistics', start, { error: String(err) }), { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getToolUsageStats } from '@/lib/dashboard/dashboardService';
import { getToolHealth } from '@/lib/dashboard/healthService';
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
      getToolUsageStats(),
      getToolHealth(),
    ]);
    return NextResponse.json(ok({ stats, health }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch tool usage statistics', start, { error: String(err) }), { status: 500 });
  }
}

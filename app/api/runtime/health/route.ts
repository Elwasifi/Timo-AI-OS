import { NextRequest, NextResponse } from 'next/server';
import { getSystemHealth } from '@/lib/dashboard/healthService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const data = await getSystemHealth();
    return NextResponse.json(ok(data, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch system health', start, { error: String(err) }), { status: 500 });
  }
}

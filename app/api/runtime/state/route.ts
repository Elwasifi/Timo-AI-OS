import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeState } from '@/lib/swarm/runtimeStore';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const data = await getRuntimeState();
    return NextResponse.json(ok(data, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch runtime state', start, { error: String(err) }), { status: 500 });
  }
}

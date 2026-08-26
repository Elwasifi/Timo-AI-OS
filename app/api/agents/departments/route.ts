import { NextRequest, NextResponse } from 'next/server';
import { loadDepartmentsWithAgents } from '@/lib/agents/agentRegistryService';
import { ok, fail, internalError } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const departments = await loadDepartmentsWithAgents();
    return NextResponse.json(ok(departments, start, { count: departments.length }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch departments', start, { error: String(err) }), { status: 500 });
  }
}

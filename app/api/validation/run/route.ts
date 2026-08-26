import { NextRequest, NextResponse } from 'next/server';
import { runValidationSuite, cleanupTestData } from '@/lib/validation/runner';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This route deletes rows from `structured_facts` (test cleanup) on every
// invocation — genuinely destructive, so it must never be reachable
// unauthenticated (V1 Section 7: RLS is not a backstop server-side).
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const cleanup = body.cleanup === true;

    if (cleanup) {
      const deleted = await cleanupTestData();
      return NextResponse.json({ cleanup: true, deleted });
    }

    const result = await runValidationSuite();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Validation suite failed' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getMission, getFullMission } from '@/lib/swarm/missionService';
import { ok, fail, notFound, badRequest, internalError } from '@/lib/api/response';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });

    const id = params.id;
    if (!id) return NextResponse.json(badRequest('Mission ID required', start), { status: 400 });

    // missionService.ts's supabase client is service-role server-side
    // (lib/supabase/client.ts) — RLS does not backstop this route, so tenant
    // membership must be checked explicitly before returning mission content.
    const mission = await getMission(id);
    if (!mission) return NextResponse.json(notFound('Mission not found', start), { status: 404 });
    if (!(await isTenantMember(user.id, mission.tenantId))) {
      return NextResponse.json(notFound('Mission not found', start), { status: 404 });
    }

    const full = await getFullMission(id);
    if (!full.mission) return NextResponse.json(notFound('Mission not found', start), { status: 404 });

    return NextResponse.json(ok(full, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch mission details', start, { error: String(err) }), { status: 500 });
  }
}

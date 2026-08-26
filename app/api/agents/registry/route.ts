import { NextResponse } from 'next/server';
import {
  loadAgents,
  getChief,
  getAgentById,
  createAgent,
  updateAgent,
  type CreateAgentInput,
} from '@/lib/agents/agentRegistryService';
import { ok, badRequest, internalError, fail } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) {
      return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });
    }

    const [agents, chief] = await Promise.all([
      loadAgents(),
      getChief(),
    ]);
    return NextResponse.json(ok({ agents, chief }, start, { count: agents.length }));
  } catch (err) {
    return NextResponse.json(internalError('Failed to fetch agent registry', start, { error: String(err) }), { status: 500 });
  }
}

// Create a new agent (worker or manager) — Agent Management (Settings).
// Job title (`role`) is set once at creation and is not editable afterward
// (enforced by not exposing a role field on the PATCH route).
export async function POST(req: Request) {
  const start = Date.now();
  try {
    // V1: this route runs server-side with service-role trust (see
    // lib/supabase/client.ts) — RLS is not a backstop here, so the caller
    // must be verified explicitly before any write is allowed.
    const user = await requireUser(req);
    if (!user) {
      return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });
    }

    const body = await req.json();
    const { id, displayName, role, level, departmentId, parentId, capabilities } = body ?? {};

    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json(badRequest('id is required', start), { status: 400 });
    }
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return NextResponse.json(badRequest('displayName is required', start), { status: 400 });
    }
    if (typeof role !== 'string' || !role.trim()) {
      return NextResponse.json(badRequest('role (job title) is required', start), { status: 400 });
    }
    if (level !== 'manager' && level !== 'worker') {
      return NextResponse.json(badRequest('level must be "manager" or "worker" — a second chief cannot be created', start), { status: 400 });
    }

    const existing = await getAgentById(id);
    if (existing) {
      return NextResponse.json(badRequest(`Agent id "${id}" already exists`, start), { status: 400 });
    }

    // Respect hierarchy: workers must report to an existing active manager;
    // managers default to reporting to the chief (temo).
    const effectiveParentId = typeof parentId === 'string' && parentId ? parentId : 'temo';
    const parent = await getAgentById(effectiveParentId);
    if (!parent) {
      return NextResponse.json(badRequest(`Parent agent "${effectiveParentId}" does not exist`, start), { status: 400 });
    }
    if (level === 'worker' && parent.level !== 'manager') {
      return NextResponse.json(badRequest('A worker must report to a manager', start), { status: 400 });
    }
    if (level === 'manager' && parent.level !== 'chief') {
      return NextResponse.json(badRequest('A manager must report to the chief', start), { status: 400 });
    }

    const input: CreateAgentInput = {
      id: id.trim(),
      displayName: displayName.trim(),
      role: role.trim(),
      level,
      parentId: parent.id,
      departmentId: typeof departmentId === 'string' && departmentId ? departmentId : parent.departmentId,
      capabilities: Array.isArray(capabilities) ? capabilities.filter((c) => typeof c === 'string') : [],
    };

    const created = await createAgent(input);

    // Keep the parent's childrenIds in sync (matches the pattern already
    // used by the agent_registry seed migrations).
    if (!parent.childrenIds.includes(created.id)) {
      await updateAgent(parent.id, { childrenIds: [...parent.childrenIds, created.id] });
    }

    return NextResponse.json(ok(created, start), { status: 201 });
  } catch (err) {
    return NextResponse.json(internalError('Failed to create agent', start, { error: String(err) }), { status: 500 });
  }
}

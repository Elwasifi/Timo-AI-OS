import { NextResponse } from 'next/server';
import { getAgentById, updateAgent, deleteAgent, type UpdateAgentInput } from '@/lib/agents/agentRegistryService';
import type { AgentPermissions } from '@/lib/agents/types';
import { ok, badRequest, notFound, internalError, fail } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KNOWN_PERMISSION_KEYS = [
  'canRouteTasks', 'canAccessMemory', 'canExecuteWorkflows', 'canManageAgents', 'canManageWorkers',
] as const;

// Rename an agent, change its avatar image, or configure its capabilities/
// tools/permissions/system prompt — the existing Agent Registry fields
// (lib/agents/types.ts) already represent per-agent "Skill" config, so this
// route just exposes the rest of the model that createAgent already writes
// on creation. Job title (`role`) is system-controlled and is intentionally
// NOT accepted here. Every field is optional — each Settings control (avatar
// upload, rename, configure panel) only ever sends what it changed.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) {
      return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });
    }

    const body = await req.json();
    if ('role' in (body ?? {})) {
      return NextResponse.json(
        badRequest('Job title is system-controlled and cannot be changed.', start),
        { status: 400 },
      );
    }
    const { displayName, avatarUrl, capabilities, tools, permissions, systemPromptTemplate } = body ?? {};
    if (
      displayName === undefined && avatarUrl === undefined && capabilities === undefined &&
      tools === undefined && permissions === undefined && systemPromptTemplate === undefined
    ) {
      return NextResponse.json(badRequest('No recognized fields to update', start), { status: 400 });
    }
    if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim())) {
      return NextResponse.json(badRequest('displayName must be a non-empty string', start), { status: 400 });
    }
    if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== 'string') {
      return NextResponse.json(badRequest('avatarUrl must be a string or null', start), { status: 400 });
    }
    if (capabilities !== undefined && (!Array.isArray(capabilities) || !capabilities.every((c) => typeof c === 'string'))) {
      return NextResponse.json(badRequest('capabilities must be an array of strings', start), { status: 400 });
    }
    if (tools !== undefined && (!Array.isArray(tools) || !tools.every((t) => typeof t === 'string'))) {
      return NextResponse.json(badRequest('tools must be an array of strings', start), { status: 400 });
    }
    if (systemPromptTemplate !== undefined && systemPromptTemplate !== null && typeof systemPromptTemplate !== 'string') {
      return NextResponse.json(badRequest('systemPromptTemplate must be a string or null', start), { status: 400 });
    }
    let cleanPermissions: AgentPermissions | undefined;
    if (permissions !== undefined) {
      if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
        return NextResponse.json(badRequest('permissions must be an object', start), { status: 400 });
      }
      cleanPermissions = {};
      for (const key of KNOWN_PERMISSION_KEYS) {
        if (typeof permissions[key] === 'boolean') cleanPermissions[key] = permissions[key];
      }
    }

    const existing = await getAgentById(params.id);
    if (!existing) {
      return NextResponse.json(notFound('Agent not found', start), { status: 404 });
    }

    const patch: UpdateAgentInput = {};
    if (displayName !== undefined) patch.displayName = displayName.trim();
    if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl;
    if (capabilities !== undefined) patch.capabilities = capabilities;
    if (tools !== undefined) patch.tools = tools;
    if (cleanPermissions !== undefined) patch.permissions = cleanPermissions;
    if (systemPromptTemplate !== undefined) patch.systemPromptTemplate = systemPromptTemplate;

    const updated = await updateAgent(params.id, patch);
    return NextResponse.json(ok(updated, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to update agent', start, { error: String(err) }), { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) {
      return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });
    }

    const result = await deleteAgent(params.id);
    if (!result.success) {
      return NextResponse.json(badRequest(result.error ?? 'Delete failed', start), { status: 409 });
    }
    return NextResponse.json(ok({ id: params.id, deleted: true }, start));
  } catch (err) {
    return NextResponse.json(internalError('Failed to delete agent', start, { error: String(err) }), { status: 500 });
  }
}

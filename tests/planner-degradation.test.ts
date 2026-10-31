// M7-13e: the tool planner now needs a resolved tenant. A missing tenant must
// never turn into a broken chat reply — callers degrade to a normal answer —
// while every OTHER planner failure keeps behaving exactly as before.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => [{ id: 'n8n.list', name: 'List', description: 'd', requiredParams: [], optionalParams: [] }]),
    list: vi.fn(() => [{ id: 'n8n.list', category: 'n8n' }]),
    get: vi.fn(() => undefined),
  },
}));
vi.mock('@/lib/tools/builtin-tools', () => ({ ensureBuiltinToolsRegistered: vi.fn() }));
vi.mock('@/lib/tools/permissions', () => ({ permissionEngine: { getPermissions: vi.fn(() => []) } }));
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));
vi.mock('@/lib/tools/chain', () => ({ createChain: vi.fn() }));
vi.mock('@/lib/ai/router', () => ({
  route: vi.fn(async () => ({ candidates: [], taskType: 'TOOL_EXECUTION', mode: 'fallback_static' })),
  classifyTask: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/ai-provider', () => ({
  chatWithFallback: vi.fn(async () => ({ content: '{"tools":[],"explanation":"no matching tool"}' })),
  AIProviderError: class extends Error {},
}));

import { toolPlanner, ToolPlanningError } from '@/lib/tools/planner';
import { decideTools } from '@/lib/context/tool-decision';
import { chatWithFallback } from '@/lib/ai/ai-provider';
import { route } from '@/lib/ai/router';
import type { DetectedIntent } from '@/lib/context/types';

const n8nIntent = { asksForToolAction: true, toolCategoryHint: 'n8n', asksAboutTimeline: false } as unknown as DetectedIntent;

beforeEach(() => {
  vi.mocked(chatWithFallback).mockClear();
  vi.mocked(route).mockClear();
});

describe('toolPlanner.planSafely — degrades ONLY the missing-tenant failure', () => {
  it('no tenant -> { plan: null, failure } (code no_tenant), no route()/provider call, nothing thrown', async () => {
    const r = await toolPlanner.planSafely('list workflows', 'flow', [], null);
    expect(r.plan).toBeNull();
    expect(r.failure).toBeInstanceOf(ToolPlanningError);
    expect(r.failure?.code).toBe('no_tenant');
    expect(route).not.toHaveBeenCalled();
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('with a tenant it behaves exactly like plan()', async () => {
    const r = await toolPlanner.planSafely('list workflows', 'flow', [], 'client-tenant');
    expect(r.failure).toBeNull();
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('any OTHER planner failure (providers exhausted) still THROWS, unchanged', async () => {
    vi.mocked(chatWithFallback).mockRejectedValueOnce(new Error('All AI providers are currently rate-limited.'));
    await expect(toolPlanner.planSafely('list workflows', 'flow', [], 'client-tenant')).rejects.toBeInstanceOf(ToolPlanningError);
  });
});

describe('decideTools — a missing tenant does not break the chat reply', () => {
  it('returns attempted_failed with the planner reason instead of throwing, and makes no AI call', async () => {
    const result = await decideTools('show my n8n workflows', n8nIntent, 'flow', null);
    // context-manager.ts (line 371) treats attempted_failed by trying the agent loop and then falling through
    // to the normal LLM reply — so the user still gets an answer rather than an error.
    expect(result.outcome).toBe('attempted_failed');
    expect(result.shouldUseTool).toBe(true);
    expect(result.error).toMatch(/resolved tenant/i);
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('with a tenant, planning proceeds normally (route + provider call carry the tenant)', async () => {
    await decideTools('show my n8n workflows', n8nIntent, 'flow', 'client-tenant');
    expect(vi.mocked(route).mock.calls[0][0]).toMatchObject({ tenantId: 'client-tenant' });
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });
});

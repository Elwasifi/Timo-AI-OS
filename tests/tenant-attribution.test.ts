// M7-13e: LLM calls that used to pass tenantId: null (which the ai-chat edge
// function resolves as the INTERNAL tenant, i.e. the internal tenant's keys)
// must carry the real tenant, and fail CLOSED — no provider call at all — when
// no tenant is resolved.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => [
      { id: 'n8n.list', name: 'List', description: 'd', requiredParams: [], optionalParams: [] },
    ]),
  },
}));
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: {} }));
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
import { route } from '@/lib/ai/router';
import { chatWithFallback } from '@/lib/ai/ai-provider';

beforeEach(() => {
  vi.mocked(route).mockClear();
  vi.mocked(chatWithFallback).mockClear();
});

describe('toolPlanner.plan — tenant attribution', () => {
  it('with no resolved tenant: throws ToolPlanningError and makes NO route()/provider call (fail closed)', async () => {
    await expect(toolPlanner.plan('list workflows', 'flow', [], null)).rejects.toBeInstanceOf(ToolPlanningError);
    await expect(toolPlanner.plan('list workflows', 'flow', [], undefined)).rejects.toBeInstanceOf(ToolPlanningError);
    expect(route).not.toHaveBeenCalled();
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('with a tenant: route() and usageContext both carry THAT tenant id (never null)', async () => {
    await toolPlanner.plan('list workflows', 'flow', [], 'client-tenant');
    expect(vi.mocked(route).mock.calls[0][0]).toMatchObject({ tenantId: 'client-tenant' });
    const opts = vi.mocked(chatWithFallback).mock.calls[0][1] as { usageContext: { tenantId: string; operation: string } };
    expect(opts.usageContext).toMatchObject({ operation: 'tool_planning', tenantId: 'client-tenant' });
  });
});

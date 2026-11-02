// M7-13c-2a: workers (nova-frontend, ...) use their MANAGER's tool grants.
// Every built-in tool lists manager ids in supportedAgents, so listForAgent() used to return
// nothing for a worker, toolPlanner.plan() returned null before any AI call, and every worker
// task failed with "No matching tool could be planned or matched". Permissions are still the
// worker's own. Real registry + real built-in tools; no network, no DB.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('@/lib/ai/router', () => ({
  route: vi.fn(async () => ({ candidates: [], taskType: 'TOOL_EXECUTION', mode: 'fallback_static' })),
  classifyTask: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/ai-provider', () => ({
  chatWithFallback: vi.fn(async () => ({ content: '{"tools":[],"explanation":"no matching tool"}' })),
  AIProviderError: class extends Error {},
}));

import { toolRegistry, resolveToolOwnerIds, rememberAgentParents } from '@/lib/tools/registry';
import { ensureBuiltinToolsRegistered } from '@/lib/tools/builtin-tools';
import { AGENT_PERMISSIONS, type ToolDefinition } from '@/lib/tools/types';
import { agentToolBridge } from '@/lib/tools/agent-bridge';
import { toolPlanner } from '@/lib/tools/planner';
import { chatWithFallback } from '@/lib/ai/ai-provider';

beforeAll(() => { ensureBuiltinToolsRegistered(); });

const ids = (list: ToolDefinition[]) => list.map((t) => t.id).sort();
const listFor = (agentId: string, perms = AGENT_PERMISSIONS[agentId] ?? []) => toolRegistry.listForAgent(agentId, perms);

const fakeTool = (id: string, supportedAgents: string[]): ToolDefinition => ({
  id, name: id, description: id, category: 'web', permissions: ['web'],
  requiredParams: [], optionalParams: [], responseSchema: { type: 'object', fields: {} },
  status: 'active', version: '1.0.0', supportedAgents,
});

describe('resolveToolOwnerIds', () => {
  it('a worker resolves to itself plus its manager (static seed from agent definitions)', () => {
    expect(resolveToolOwnerIds('nova-frontend')).toEqual(['nova-frontend', 'nova']);
    expect(resolveToolOwnerIds('nova-backend')).toEqual(['nova-backend', 'nova']);
    expect(resolveToolOwnerIds('nova-qa')).toEqual(['nova-qa', 'nova']);
  });

  it('a manager does NOT inherit the chief (that would hand every manager the chief\'s tools); chief and unknown ids resolve to themselves', () => {
    expect(resolveToolOwnerIds('nova')).toEqual(['nova']);
    expect(resolveToolOwnerIds('echo')).toEqual(['echo']);
    expect(resolveToolOwnerIds('temo')).toEqual(['temo']);
    expect(resolveToolOwnerIds('no-such-agent')).toEqual(['no-such-agent']);
  });

  it('a worker that only exists in the live registry resolves from the rows agentRegistryService loaded; non-workers in those rows are ignored', () => {
    rememberAgentParents([
      { id: 'echo-copywriter', level: 'worker', parentId: 'echo' },
      { id: 'some-manager', level: 'manager', parentId: 'temo' },
      { id: 'orphan-worker', level: 'worker', parentId: null },
    ]);
    expect(resolveToolOwnerIds('echo-copywriter')).toEqual(['echo-copywriter', 'echo']);
    expect(resolveToolOwnerIds('some-manager')).toEqual(['some-manager']);
    expect(resolveToolOwnerIds('orphan-worker')).toEqual(['orphan-worker']);
  });
});

describe('listForAgent — real built-in tools', () => {
  it('nova-frontend gets web.search and the files/github tools through nova (this was [] before)', () => {
    const got = ids(listFor('nova-frontend'));
    expect(got).toContain('web.search');
    expect(got).toEqual(expect.arrayContaining(['files.read', 'files.write', 'github.createPR', 'github.commitFile']));
  });

  it('a worker with the same permissions as its manager sees exactly the manager\'s tools', () => {
    expect(ids(listFor('nova-frontend'))).toEqual(ids(listFor('nova')));
    expect(ids(listFor('nova-qa'))).toEqual(ids(listFor('nova')));
  });

  it('permissions are NOT inherited: the worker is limited by its OWN scope', () => {
    // nova (manager) can use memory.* by supportedAgents, but neither nova nor its workers have the memory permission
    expect(ids(listFor('nova-frontend'))).not.toContain('memory.search');
    expect(ids(listFor('nova-frontend'))).not.toContain('n8n.listWorkflows');
    // a narrower worker scope narrows the result even though the manager supports more
    const filesOnly = ids(toolRegistry.listForAgent('nova-frontend', ['files']));
    expect(filesOnly).toEqual(['files.read', 'files.write']);
    // and a worker with NO permissions gets nothing
    expect(toolRegistry.listForAgent('nova-frontend', [])).toEqual([]);
  });

  it('an agent with no parent is unchanged (echo, luna)', () => {
    expect(ids(listFor('luna'))).toEqual(['files.read', 'files.write', 'web.search']);
    expect(ids(listFor('echo'))).toEqual(expect.arrayContaining(['web.search', 'google.gmail.send', 'memory.search']));
    expect(ids(listFor('echo'))).not.toContain('files.write');
  });

  it('tools with an empty supportedAgents list still apply to everyone (workers, unknown agents) as before', () => {
    toolRegistry.register(fakeTool('test.open', []), async () => ({}));
    try {
      expect(ids(toolRegistry.listForAgent('nova-frontend', ['web']))).toContain('test.open');
      expect(ids(toolRegistry.listForAgent('some-unknown-agent', ['web']))).toContain('test.open');
    } finally {
      toolRegistry.unregister('test.open');
    }
  });

  it('a tool that lists only the chief is NOT visible to a manager or its workers', () => {
    toolRegistry.register(fakeTool('test.chiefOnly', ['temo']), async () => ({}));
    try {
      expect(ids(toolRegistry.listForAgent('nova', ['web']))).not.toContain('test.chiefOnly');
      expect(ids(toolRegistry.listForAgent('nova-frontend', ['web']))).not.toContain('test.chiefOnly');
      expect(ids(toolRegistry.listForAgent('temo', ['web']))).toContain('test.chiefOnly');
    } finally {
      toolRegistry.unregister('test.chiefOnly');
    }
  });
});

describe('call sites', () => {
  afterEach(() => { vi.mocked(chatWithFallback).mockClear(); });

  it('agent-bridge.availableTools gives a worker its manager\'s tools', () => {
    expect(ids(agentToolBridge.availableTools('nova-frontend'))).toContain('web.search');
  });

  it('toolPlanner.plan() now reaches the AI for a worker task (before: returned null before any AI call) and offers it web.search', async () => {
    const plan = await toolPlanner.plan('find an open source jarvis assistant', 'nova-frontend', AGENT_PERMISSIONS['nova-frontend'], 'client-tenant');
    expect(plan).not.toBeNull();
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
    const options = vi.mocked(chatWithFallback).mock.calls[0][1] as { systemPrompt: string };
    expect(options.systemPrompt).toContain('web.search');
    expect(options.systemPrompt).not.toContain('memory.search'); // the worker's own permissions still apply
  });

  it('a worker with no resolvable manager (unknown id) still gets no planner call — behaviour unchanged', async () => {
    const plan = await toolPlanner.plan('anything', 'unknown-worker-x', ['web'], 'client-tenant');
    // 'unknown-worker-x' is in no supportedAgents list; only empty-list tools could apply and none are registered
    expect(plan).toBeNull();
    expect(chatWithFallback).not.toHaveBeenCalled();
  });
});

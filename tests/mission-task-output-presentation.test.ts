// M7-13c-2e-a Part A (mission side): a mission task that answers from web.search stores the PRESENTED text as its output (and in the
// timeline detail), not the model-facing labelled summary. Real executeTask AND real decideTools; planner, executor, registry and
// every persistence collaborator are stubbed (no network, no DB).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  updateTask: vi.fn(async (_id: string, _patch: Record<string, unknown>) => null),
  events: [] as Array<{ type: string; title?: string; detail?: string }>,
}));

vi.mock('@/lib/ai/router', () => ({ route: vi.fn(), classifyTask: vi.fn(() => ({})) }));
vi.mock('@/lib/swarm/agentLoop', () => ({ runAgentLoop: vi.fn() }));
vi.mock('@/lib/settings/settings-service', () => ({ loadSettings: vi.fn(async () => ({ temperature: 0.7, max_tokens: 2048, active_provider: 'groq' })) }));
vi.mock('@/lib/agents/agentRegistryService', () => ({ getAgentById: vi.fn(async (id: string) => ({ id, displayName: id, capabilities: [], tools: [] })) }));
vi.mock('@/lib/crew/manager-delegation', () => ({ executeWorker: vi.fn(), managerReview: vi.fn() }));
vi.mock('@/lib/swarm/managerContext', () => ({ buildManagerContext: vi.fn() }));
vi.mock('@/lib/swarm/workerRouter', () => ({
  findWorkerForTask: vi.fn(async () => ({ agent: { id: 'nova-frontend', displayName: 'Frontend', capabilities: [] } })),
  resolveRoleId: vi.fn(() => 'role'),
}));
vi.mock('@/lib/swarm/missionService', () => ({
  updateTask: h.updateTask,
  claimTask: vi.fn(async (id: string) => ({ id })),
  appendExecutionLog: vi.fn(async () => {}),
  getTasks: vi.fn(async () => []),
}));
vi.mock('@/lib/swarm/missionEngine', () => ({ recalculateProgress: vi.fn(async () => {}), recalculateObjectiveStatus: vi.fn(async () => {}) }));
vi.mock('@/lib/swarm/missionTimeline', () => ({
  recordEvent: vi.fn(async (_m: string, type: string, p: { title?: string; detail?: string }) => { h.events.push({ type, title: p?.title, detail: p?.detail }); }),
  recordTaskStarted: vi.fn(async () => {}), recordTaskCompleted: vi.fn(async () => {}), recordTaskFailed: vi.fn(async () => {}),
}));
vi.mock('@/lib/swarm/runtimeStore', () => ({ emitRuntimeEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/governance/executionMode', () => ({ getTenantExecutionMode: vi.fn(async () => 'live') }));
vi.mock('@/lib/tools/registry', () => ({
  toolRegistry: {
    listForAgent: vi.fn(() => [{ id: 'web.search' }]),
    list: vi.fn(() => [{ id: 'web.search', category: 'web' }]),
    get: vi.fn((id: string) => ({ definition: { id, name: id } })),
  },
}));
vi.mock('@/lib/tools/builtin-tools', () => ({ ensureBuiltinToolsRegistered: vi.fn() }));
vi.mock('@/lib/tools/permissions', () => ({ permissionEngine: { getPermissions: vi.fn(() => ['web']) } }));
vi.mock('@/lib/tools/planner', async (orig) => {
  const actual = await orig<typeof import('@/lib/tools/planner')>();
  return { ...actual, toolPlanner: { plan: vi.fn() } };
});
vi.mock('@/lib/tools/executor', () => ({ toolExecutor: { execute: vi.fn() } }));

import { executeTask } from '@/lib/swarm/executionLayer';
import { presentWebSearchForUser } from '@/lib/tools/webSearchPresentation';
import { toolPlanner } from '@/lib/tools/planner';
import { toolExecutor } from '@/lib/tools/executor';
import { tavilyLive, geminiLive } from './fixtures/webSearchFixtures';

const BANNER = /untrusted|Web search results via|external web content|not instructions/i;
const task = { id: 'task-1', missionId: 'm-1', assignedManager: 'nova', assignedWorker: null, requiredCapability: 'research', title: 'Search the web for open source Jarvis projects', description: 'd', status: 'ready', maxRetries: 3, retries: 0 };
const mission = { id: 'm-1', tenantId: 'client-tenant', userRequest: 'find jarvis', isSimulation: false, estimatedComplexity: 'medium' } as never;
const envelope = (data: unknown) => ({ ok: true, toolId: 'web.search', requestId: 'r', agentId: 'nova-frontend', data, durationMs: 1, retries: 0, streaming: false, timestamp: 1, executionMode: 'live' });
const completedPatch = () => h.updateTask.mock.calls.map((c) => c[1]).find((p) => p.status === 'completed') as Record<string, any>;

async function run() {
  const p = executeTask(task as never, mission, null, []);
  await vi.advanceTimersByTimeAsync(30_000);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.updateTask.mockClear();
  h.events.length = 0;
  vi.mocked(toolPlanner.plan).mockReset();
  vi.mocked(toolExecutor.execute).mockReset();
  vi.mocked(toolPlanner.plan).mockResolvedValue({ tools: [{ toolId: 'web.search', arguments: { query: 'open source jarvis' } }], explanation: 'x' } as never);
});
afterEach(() => vi.useRealTimers());

describe('mission task output from web.search', () => {
  it('Tavily: result.output is the presented text (answer + Sources), without the untrusted header, banner or snippets', async () => {
    vi.mocked(toolExecutor.execute).mockResolvedValue(envelope(tavilyLive) as never);
    const r = await run();
    expect(r.status).toBe('completed');
    const output = completedPatch().result.output as string;
    expect(output).toBe(presentWebSearchForUser(tavilyLive));
    expect(output).not.toMatch(BANNER);
    expect(output).not.toContain('modular, privacy-first assistant');
    expect(output).toContain('[Leon');
    expect(completedPatch().result.tools).toEqual(['web.search']);
    // the in-memory result mirrors what was stored
    expect(r.result).toEqual(completedPatch().result);
  });

  it('the timeline detail of the successful tool step is the presented text too (no banner)', async () => {
    vi.mocked(toolExecutor.execute).mockResolvedValue(envelope(tavilyLive) as never);
    await run();
    const ev = h.events.find((e) => e.type === 'workflow_executed' && /succeeded/.test(e.title ?? ''));
    expect(ev?.detail).toBeTruthy();
    expect(ev?.detail).not.toMatch(BANNER);
    expect(ev?.detail).toBe(presentWebSearchForUser(tavilyLive).slice(0, 300));
  });

  it('Gemini: the grounded answer is the output, with its sources as links', async () => {
    vi.mocked(toolExecutor.execute).mockResolvedValue(envelope(geminiLive) as never);
    await run();
    const output = completedPatch().result.output as string;
    expect(output.startsWith('Open-source Jarvis-style assistants include Open-JARVIS and Leon.')).toBe(true);
    expect(output).toContain('[github.com](https://github.com/Open-JARVIS/jarvis)');
  });
});

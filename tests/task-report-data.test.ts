// M7-13c-2b-1: every task carries STRUCTURED report data in mission_tasks.result (no migration):
//   completed: { output, steps, tools: [...], simulated?, executionMode?, agent: { manager, worker } }
//   failed:    { failure: { kind, deterministic, attempts }, agent } — error_message text is NOT changed
// and the shared progress figure (resolved / total) is used by the "Mission progress" timeline event.
// Real executeTask / executeMissionTasks and the real outcome function; collaborators are stubbed (no network).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  decide: vi.fn(),
  updateTask: vi.fn(async (_id: string, _patch: Record<string, unknown>) => null),
  tenantMode: vi.fn(async (_tenant: string) => 'sandbox'),
  events: [] as Array<{ type: string; title?: string; detail?: string; metadata?: Record<string, any> }>,
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
  recordEvent: vi.fn(async (_m: string, type: string, p: { title?: string; detail?: string; metadata?: Record<string, any> }) => { h.events.push({ type, title: p?.title, detail: p?.detail, metadata: p?.metadata }); }),
  recordTaskStarted: vi.fn(async () => {}), recordTaskCompleted: vi.fn(async () => {}), recordTaskFailed: vi.fn(async () => {}),
}));
vi.mock('@/lib/swarm/runtimeStore', () => ({ emitRuntimeEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/governance/executionMode', () => ({ getTenantExecutionMode: h.tenantMode }));
vi.mock('@/lib/context/tool-decision', async (orig) => {
  const actual = await orig<typeof import('@/lib/context/tool-decision')>();
  return { ...actual, decideTools: h.decide };
});

import { executeTask, executeMissionTasks } from '@/lib/swarm/executionLayer';
import { computeMissionOutcome } from '@/lib/swarm/missionOutcome';

const baseTask = {
  id: 'task-1', missionId: 'm-1', assignedManager: 'nova', assignedWorker: null, requiredCapability: 'research',
  title: 'Research the topic', description: 'd', status: 'ready', maxRetries: 3, retries: 0,
};
const mission = (over: Record<string, unknown> = {}) => ({ id: 'm-1', tenantId: 'client-tenant', userRequest: 'find jarvis', isSimulation: false, estimatedComplexity: 'medium', ...over }) as never;

const env = (over: Record<string, unknown>) => ({ ok: true, toolId: 'web.search', requestId: 'r', agentId: 'nova-frontend', data: {}, durationMs: 1, retries: 0, streaming: false, timestamp: 1, ...over });
const exec = (toolId: string, result: Record<string, unknown>) => ({ toolId, toolName: toolId, arguments: {}, result: env({ toolId, ...result }), success: true, durationMs: 1 });
const answer = (executions: unknown[], toolAnswer = 'Found three Jarvis projects: A, B, C.') => ({
  shouldUseTool: true, selectedToolIds: [], executions, toolAnswer, success: true, outcome: 'handled', error: null,
});
const failure = (over: Record<string, unknown>) => ({ shouldUseTool: true, selectedToolIds: [], executions: [], toolAnswer: null, success: false, outcome: 'attempted_failed', error: null, ...over });

const completedPatch = () => h.updateTask.mock.calls.map((c) => c[1]).find((p) => p.status === 'completed') as Record<string, any>;
const failedPatch = () => h.updateTask.mock.calls.map((c) => c[1]).find((p) => p.status === 'failed') as Record<string, any>;

async function run(task: unknown = baseTask, m = mission()) {
  const p = executeTask(task as never, m, null, []);
  await vi.advanceTimersByTimeAsync(30_000);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.decide.mockReset(); h.updateTask.mockClear(); h.tenantMode.mockReset(); h.tenantMode.mockResolvedValue('sandbox'); h.events.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('completed task: structured report data in result', () => {
  it('real tool run: tools, executionMode from the tool result, agent (manager + worker), no simulated key', async () => {
    h.decide.mockResolvedValue(answer([exec('web.search', { executionMode: 'live' })]));
    const r = await run();
    expect(r.status).toBe('completed');
    const patch = completedPatch();
    expect(patch.result).toMatchObject({
      output: 'Found three Jarvis projects: A, B, C.',
      tools: ['web.search'],
      executionMode: 'live',
      agent: { manager: 'nova', worker: 'nova-frontend' },
    });
    expect(Array.isArray(patch.result.steps)).toBe(true);
    expect('simulated' in patch.result).toBe(false);
    expect(h.tenantMode).not.toHaveBeenCalled(); // only asked when a result was simulated
    expect(r).toMatchObject({ tools: ['web.search'], executionMode: 'live' });
    expect(r.simulated).toBeUndefined();
    expect(r.result).toEqual(patch.result); // the in-memory result mirrors what was stored
  });

  it('several tools: de-duplicated list, in order of first use', async () => {
    h.decide.mockResolvedValue(answer([exec('web.search', { executionMode: 'sandbox' }), exec('files.read', {}), exec('web.search', {})]));
    await run();
    expect(completedPatch().result.tools).toEqual(['web.search', 'files.read']);
  });

  it('simulated in Demo/sandbox: simulated=true and executionMode = the tenant mode (sandbox), not the envelope\'s "simulation"', async () => {
    h.decide.mockResolvedValue(answer([exec('gmail.send', { simulated: true, executionMode: 'simulation' })], 'Simulated execution of "gmail.send" — no real external action was taken.'));
    const r = await run();
    expect(h.tenantMode).toHaveBeenCalledWith('client-tenant');
    expect(completedPatch().result).toMatchObject({ simulated: true, executionMode: 'sandbox', tools: ['gmail.send'] });
    expect(r).toMatchObject({ simulated: true, executionMode: 'sandbox', tools: ['gmail.send'] });
  });

  it('simulated because the MISSION is a simulation: executionMode "simulation", tenant mode not consulted', async () => {
    h.decide.mockResolvedValue(answer([exec('gmail.send', { simulated: true, executionMode: 'simulation' })], 'Simulated execution of "gmail.send" — no real external action was taken.'));
    await run(baseTask, mission({ isSimulation: true }));
    expect(completedPatch().result).toMatchObject({ simulated: true, executionMode: 'simulation' });
    expect(h.tenantMode).not.toHaveBeenCalled();
  });

  it('simulated while the tenant is LIVE is recorded as such — and the outcome counts it as an anomaly, not a success', async () => {
    h.tenantMode.mockResolvedValue('live');
    h.decide.mockResolvedValue(answer([exec('gmail.send', { simulated: true, executionMode: 'simulation' })], 'Simulated execution of "gmail.send" — no real external action was taken.'));
    await run();
    const stored = completedPatch().result;
    expect(stored).toMatchObject({ simulated: true, executionMode: 'live' });
    const outcome = computeMissionOutcome([{ id: 'x', title: 'T', status: 'completed', result: stored }]);
    expect(outcome.counts).toMatchObject({ anomalous: 1, simulated: 0, succeeded: 0 });
    expect(outcome.status).toBe('failed');
  });

  it('a chain result (results: [...]) with a simulated step counts as simulated', async () => {
    h.decide.mockResolvedValue(answer([{ toolId: 'chain', toolName: 'chain', arguments: {}, success: true, durationMs: 1, result: { results: [env({ executionMode: 'sandbox' }), env({ simulated: true, executionMode: 'simulation' })] } }]));
    await run();
    expect(completedPatch().result.simulated).toBe(true);
  });

  it('the stored result round-trips through the outcome function into a full report', async () => {
    h.decide.mockResolvedValue(answer([exec('web.search', { executionMode: 'live' })]));
    await run();
    const o = computeMissionOutcome([{ id: 'x', title: 'Research', status: 'completed', result: completedPatch().result, assignedManager: 'nova' }]);
    expect(o.parts.tasks[0]).toMatchObject({ state: 'succeeded', manager: 'nova', worker: 'nova-frontend', tools: ['web.search'], result: 'Found three Jarvis projects: A, B, C.' });
    expect(o.parts.tasks[0].method).toContain('Tool Decision');
  });
});

describe('failed task: failure kind, deterministic?, attempts — error_message text unchanged', () => {
  it('a deterministic failure: kind from the tool decision, deterministic=true, attempts=1', async () => {
    h.decide.mockResolvedValue(failure({ failureKind: 'no_match', error: 'No matching tool could be planned or matched for this request.' }));
    const r = await run();
    const patch = failedPatch();
    expect(patch.errorMessage).toBe('No matching tool could be planned or matched for this request.'); // text untouched
    expect(patch.result).toEqual({ failure: { kind: 'no_match', deterministic: true, attempts: 1 }, agent: { manager: 'nova', worker: 'nova-frontend' } });
    expect(patch.retries).toBe(0);
    expect(r.result).toEqual(patch.result);
    expect(h.decide).toHaveBeenCalledTimes(1);
  });

  it('quota / not_configured are recorded as such', async () => {
    h.decide.mockResolvedValue(failure({ failureKind: 'quota_exceeded', error: "Gemini's request limit for model x was reached." }));
    await run();
    expect(failedPatch().result.failure).toEqual({ kind: 'quota_exceeded', deterministic: true, attempts: 1 });
  });

  it('a transient failure that exhausts its retries: its kind, deterministic=false, attempts = all 4', async () => {
    h.decide.mockResolvedValue(failure({ failureKind: 'tool_error', error: 'socket hang up' }));
    await run();
    expect(h.decide).toHaveBeenCalledTimes(4);
    expect(failedPatch().result.failure).toEqual({ kind: 'tool_error', deterministic: false, attempts: 4 });
    expect(failedPatch().errorMessage).toBe('socket hang up');
  });

  it('a timeout message is classified as "timeout"; anything else unknown as "execution_error"', async () => {
    h.decide.mockRejectedValue(new Error('Task timed out after 90000ms'));
    await run();
    expect(failedPatch().result.failure).toMatchObject({ kind: 'timeout', deterministic: false });
    h.updateTask.mockClear(); h.decide.mockReset();
    h.decide.mockRejectedValue(new Error('weird'));
    await run();
    expect(failedPatch().result.failure).toMatchObject({ kind: 'execution_error' });
  });

  it('a failed task\'s result has no "output" and the outcome function still reads it (reason from error_message)', async () => {
    h.decide.mockResolvedValue(failure({ failureKind: 'no_match', error: 'No matching tool could be planned or matched for this request.' }));
    await run();
    const patch = failedPatch();
    expect('output' in patch.result).toBe(false);
    const o = computeMissionOutcome([{ id: 'x', title: 'T', status: 'failed', errorMessage: patch.errorMessage, result: patch.result }]);
    expect(o.parts.tasks[0]).toMatchObject({ state: 'failed', manager: 'nova', worker: 'nova-frontend', reason: 'No matching tool could be planned or matched for this request.' });
  });
});

describe('the mission progress event uses resolved / total (the shared helper)', () => {
  it('two failed tasks: 50% then 100% (the old completed/total formula said 0% both times)', async () => {
    h.decide.mockResolvedValue(failure({ failureKind: 'no_match', error: 'No match.' }));
    const progress: string[] = [];
    const p = executeMissionTasks(mission(), [{ ...baseTask, id: 't1' }, { ...baseTask, id: 't2' }] as never, [], (title, detail) => { if (title.startsWith('Mission progress')) progress.push(`${title} | ${detail}`); });
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    expect(progress).toEqual(['Mission progress: 50% | 1/2 tasks finished', 'Mission progress: 100% | 2/2 tasks finished']);
    const ev = h.events.filter((e) => e.type === 'mission_updated');
    expect(ev.map((e) => e.title)).toEqual(['Mission progress: 50%', 'Mission progress: 100%']);
    expect(ev[1].metadata).toMatchObject({ progress: 100, resolved: 2, completed: 0, total: 2 });
  });

  it('tasks that were already completed before this run count as resolved', async () => {
    h.decide.mockResolvedValue(answer([exec('web.search', { executionMode: 'live' })]));
    const progress: string[] = [];
    const p = executeMissionTasks(mission(), [{ ...baseTask, id: 't0', status: 'completed' }, { ...baseTask, id: 't1' }] as never, [], (title) => { if (title.startsWith('Mission progress')) progress.push(title); });
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    expect(progress).toEqual(['Mission progress: 100%']);
  });
});

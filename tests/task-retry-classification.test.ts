// M7-13c-2a: the REAL mission-task retry loop (executeTask) must fail a deterministic tool
// failure immediately, with the specific reason stored, and keep retrying transient ones.
// Live: a worker task failed with the same "No matching tool could be planned or matched"
// four times in a row (4 attempts, ~11s of backoff, retries=3) for an outcome that could not change.
// Everything around the loop (DB services, agents, router, tool decision) is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ decide: vi.fn(), updateTask: vi.fn(async (_id: string, _patch: Record<string, unknown>) => null), events: [] as Array<{ type: string; detail?: string }> }));

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
  recordEvent: vi.fn(async (_m: string, type: string, p: { detail?: string }) => { h.events.push({ type, detail: p?.detail }); }),
  recordTaskStarted: vi.fn(async () => {}),
  recordTaskCompleted: vi.fn(async () => {}),
  recordTaskFailed: vi.fn(async () => {}),
}));
vi.mock('@/lib/swarm/runtimeStore', () => ({ emitRuntimeEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/context/tool-decision', async (orig) => {
  const actual = await orig<typeof import('@/lib/context/tool-decision')>();
  return { ...actual, decideTools: h.decide };
});

import { executeTask, NonRetryableTaskError } from '@/lib/swarm/executionLayer';

const task = {
  id: 'task-1', missionId: 'm-1', assignedManager: 'nova', assignedWorker: null, requiredCapability: 'code_review',
  title: 'Review code quality and identify issues', description: 'd', status: 'ready', maxRetries: 3, retries: 0,
} as never;
const mission = { id: 'm-1', tenantId: 'client-tenant', userRequest: 'search for an open source jarvis', isSimulation: false, estimatedComplexity: 'medium' } as never;

const decision = (over: Record<string, unknown>) => ({
  shouldUseTool: true, selectedToolIds: [], executions: [], toolAnswer: null, success: false, outcome: 'attempted_failed', error: null, ...over,
});

/** Runs executeTask to completion while advancing the fake clock through its retry backoff. */
async function run() {
  const p = executeTask(task, mission, null, []);
  await vi.advanceTimersByTimeAsync(30_000);
  return p;
}

const failedUpdate = () => h.updateTask.mock.calls.map((c) => c[1] as Record<string, unknown>).find((u) => u.status === 'failed');
const completedUpdate = () => h.updateTask.mock.calls.map((c) => c[1] as Record<string, unknown>).find((u) => u.status === 'completed');

beforeEach(() => {
  vi.useFakeTimers();
  h.decide.mockReset();
  h.updateTask.mockClear();
  h.events.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('deterministic failures: ONE attempt, specific stored reason', () => {
  it.each([
    ['no_match', 'No matching tool could be planned or matched for this request.'],
    ['no_tools_for_agent', 'No tools available: agent "nova-frontend" has no registered tool it is permitted to use for this request.'],
    ['invalid_params', 'Validation failed for "web.search": param "query" — required parameter missing'],
    ['not_implemented', 'Tool "files.write" is not implemented yet — no real action was taken.'],
    ['permission_denied', 'Agent "nova-frontend" lacks permission(s): memory for tool "memory.search"'],
    ['planner_no_tenant', 'Tool planning needs a resolved tenant; none was available, so no AI call was made.'],
    ['not_configured', 'web.search needs a Gemini API key for this workspace — add one in Settings → AI Providers.'],
  ])('%s -> decideTools called once, task failed with the exact reason, retries=0', async (failureKind, error) => {
    h.decide.mockResolvedValue(decision({ failureKind, error }));
    const result = await run();

    expect(h.decide).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toBe(error);
    expect(result.retries).toBe(0);
    expect(failedUpdate()).toMatchObject({ status: 'failed', errorMessage: error, retries: 0 });
    expect(h.events.some((e) => e.type === 'execution_retried')).toBe(false);
  });
});

describe('transient failures keep the existing retry behaviour', () => {
  it.each([
    ['planner_unavailable', 'The tool planner was unavailable (every AI provider failed or timed out while choosing a tool, so nothing was run) — this task can be retried. Detail: timeout'],
    ['tool_error', 'socket hang up'],
    ['empty_result', 'Tool web.search ran but returned no usable content, so the request was not answered.'],
    ['planner_unusable', 'Planner returned unparseable output'],
  ])('%s -> all 4 attempts are made (maxRetries 3), then the task fails with that reason', async (failureKind, error) => {
    h.decide.mockResolvedValue(decision({ failureKind, error }));
    const result = await run();

    expect(h.decide).toHaveBeenCalledTimes(4);
    expect(result.status).toBe('failed');
    expect(result.error).toBe(error);
    expect(result.retries).toBe(3);
    expect(h.events.filter((e) => e.type === 'execution_retried')).toHaveLength(3);
  });

  it('a transient failure that clears on the second attempt completes the task', async () => {
    h.decide
      .mockResolvedValueOnce(decision({ failureKind: 'planner_unavailable', error: 'timeout' }))
      .mockResolvedValueOnce(decision({ success: true, outcome: 'handled', toolAnswer: 'Found three Jarvis projects: A, B, C.', selectedToolIds: ['web.search'] }));
    const result = await run();
    expect(h.decide).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('Found three Jarvis projects: A, B, C.');
  });
});

describe('a placeholder answer is not a completed task', () => {
  it('toolAnswer "Result" is rejected as a degenerate output (never saved as completed)', async () => {
    h.decide.mockResolvedValue(decision({ success: true, outcome: 'handled', toolAnswer: 'Result', selectedToolIds: ['web.search'] }));
    const result = await run();
    expect(result.status).toBe('failed');
    expect(completedUpdate()).toBeUndefined();
    expect(result.error).toMatch(/degenerate result/);
  });

  it('a real answer completes and is stored as the output', async () => {
    h.decide.mockResolvedValue(decision({ success: true, outcome: 'handled', toolAnswer: 'Open-JARVIS — https://github.com/x/jarvis', selectedToolIds: ['web.search'] }));
    const result = await run();
    expect(result.status).toBe('completed');
    expect(completedUpdate()).toMatchObject({ status: 'completed', result: { output: 'Open-JARVIS — https://github.com/x/jarvis' } });
  });
});

describe('NonRetryableTaskError', () => {
  it('is a normal Error carrying the failure kind', () => {
    const e = new NonRetryableTaskError('boom', 'no_match');
    expect(e).toBeInstanceOf(Error);
    expect(e.failureKind).toBe('no_match');
    expect(e.message).toBe('boom');
  });
});

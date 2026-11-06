// M7-13c-2b-1c: a hung step in the mission task path must never leave a task 'running' for ever.
// Live (mission d2145ef1): after a failed web.search the next timeline write never settled; the task stayed running, the
// second task never started and the mission stayed 'executing'. These tests drive the REAL executeTask /
// executeMissionTasks with fake timers and injected dependencies that hang on purpose. No database.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const never = () => new Promise<never>(() => {});

const h = vi.hoisted(() => ({
  decide: vi.fn(),
  updateTask: vi.fn(),
  claimTask: vi.fn(),
  appendLog: vi.fn(),
  recalc: vi.fn(),
  recordEvent: vi.fn(),
  recordStarted: vi.fn(),
  recordCompleted: vi.fn(),
  recordFailed: vi.fn(),
  emit: vi.fn(),
  loadSettings: vi.fn(),
  route: vi.fn(),
  buildCtx: vi.fn(),
  runLoop: vi.fn(),
}));

vi.mock('@/lib/ai/router', () => ({ route: h.route, classifyTask: vi.fn(() => ({})) }));
vi.mock('@/lib/swarm/agentLoop', () => ({ runAgentLoop: h.runLoop }));
vi.mock('@/lib/settings/settings-service', () => ({ loadSettings: h.loadSettings }));
vi.mock('@/lib/agents/agentRegistryService', () => ({ getAgentById: vi.fn(async (id: string) => ({ id, displayName: id, capabilities: [], tools: [] })) }));
vi.mock('@/lib/crew/manager-delegation', () => ({ executeWorker: vi.fn(), managerReview: vi.fn() }));
vi.mock('@/lib/swarm/managerContext', () => ({ buildManagerContext: h.buildCtx }));
vi.mock('@/lib/swarm/workerRouter', () => ({ findWorkerForTask: vi.fn(async () => null), resolveRoleId: vi.fn(() => 'role') }));
vi.mock('@/lib/swarm/missionService', () => ({
  updateTask: h.updateTask,
  claimTask: h.claimTask,
  appendExecutionLog: h.appendLog,
  getTasks: vi.fn(async () => []),
}));
vi.mock('@/lib/swarm/missionEngine', () => ({ recalculateProgress: h.recalc, recalculateObjectiveStatus: vi.fn(async () => {}) }));
vi.mock('@/lib/swarm/missionTimeline', () => ({
  recordEvent: h.recordEvent,
  recordTaskStarted: h.recordStarted,
  recordTaskCompleted: h.recordCompleted,
  recordTaskFailed: h.recordFailed,
}));
vi.mock('@/lib/swarm/runtimeStore', () => ({ emitRuntimeEvent: h.emit }));
vi.mock('@/lib/context/tool-decision', async (orig) => {
  const actual = await orig<typeof import('@/lib/context/tool-decision')>();
  return { ...actual, decideTools: h.decide };
});

import { executeTask, executeMissionTasks } from '@/lib/swarm/executionLayer';
import { createTaskRunGuard } from '@/lib/swarm/taskDeadlines';
import { computeMissionOutcome, cleanReason } from '@/lib/swarm/missionOutcome';

const mk = (id: string, title: string) => ({
  id, missionId: 'm-1', objectiveId: null, assignedManager: 'nova', assignedWorker: null, requiredCapability: 'code_review',
  title, description: 'd', status: 'ready', maxRetries: 3, retries: 0,
}) as never;
const task1 = mk('task-1', 'Task one');
const task2 = mk('task-2', 'Task two');
const mission = { id: 'm-1', tenantId: 'client-tenant', userRequest: 'search for a jarvis', isSimulation: false, estimatedComplexity: 'medium' } as never;

const answer = {
  shouldUseTool: true, selectedToolIds: ['web.search'], executions: [{ toolId: 'web.search', result: { ok: true } }],
  toolAnswer: 'Found an open source Jarvis assistant: github.com/example/jarvis — summary follows.', success: true, outcome: 'handled', error: null,
};

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const f of Object.values(h)) f.mockReset();
  h.decide.mockResolvedValue(answer);
  h.updateTask.mockImplementation(async (id: string) => ({ id }));
  h.claimTask.mockImplementation(async (id: string) => ({ id }));
  h.appendLog.mockResolvedValue(undefined);
  h.recalc.mockResolvedValue(undefined);
  h.recordEvent.mockResolvedValue(undefined);
  h.recordStarted.mockResolvedValue(undefined);
  h.recordCompleted.mockResolvedValue(undefined);
  h.recordFailed.mockResolvedValue(undefined);
  h.emit.mockResolvedValue(undefined);
  h.loadSettings.mockResolvedValue({ temperature: 0.7, max_tokens: 2048, active_provider: 'groq' });
  h.route.mockResolvedValue({ selected: null, candidates: [], reason: 'test', taskType: 'x', mode: 'automatic' });
  h.buildCtx.mockResolvedValue({ systemPrompt: 's', userPrompt: 'u', agent: { model: 'm' }, relevantMemory: '', relevantKnowledge: '' });
  h.runLoop.mockResolvedValue({ output: 'A real written answer for the task.', steps: [], status: 'completed' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const writes = (id: string) => h.updateTask.mock.calls.filter((c) => c[0] === id).map((c) => ({ patch: c[1] as Record<string, unknown>, opts: c[2] as { onlyIfStatus?: string[] } | undefined }));
const terminalWrites = (id: string) => writes(id).filter((w) => w.patch.status === 'completed' || w.patch.status === 'failed');
const settled = (p: Promise<unknown>) => { const s = { done: false }; p.then(() => { s.done = true; }, () => { s.done = true; }); return s; };

const toolTimeoutReason = 'Tool step timed out after 60 s — the task was stopped without retrying so a tool action is not run twice.';

describe('C — the Tool Decision step is bounded and is NEVER retried after a timeout', () => {
  // decideTools cannot be cancelled: a live, non-read-only tool action (an email send) may still complete in the
  // background, so running the step again could execute the same side effect twice.
  it('a decideTools call that never settles fails the task at 60 s: ONE call, no retry, honest reason, existing failure shape', async () => {
    h.decide.mockImplementation(never);
    const p = executeTask(task1, mission, null, []);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(70_000);

    expect(s.done).toBe(true);
    const result = await p;
    expect(result.status).toBe('failed');
    expect(result.error).toBe(toolTimeoutReason);
    expect(result.retries).toBe(0);
    expect(h.decide).toHaveBeenCalledTimes(1);
    expect(h.recordEvent.mock.calls.some((c) => c[1] === 'execution_retried')).toBe(false);
    // the ordinary failure path ran: ONE failed write (conditional on running), task_failed, execution_failed, runtime event
    const failed = terminalWrites('task-1');
    expect(failed).toHaveLength(1);
    expect(failed[0].patch).toMatchObject({ status: 'failed', errorMessage: toolTimeoutReason, retries: 0 });
    expect(failed[0].patch.result).toMatchObject({ failure: { kind: 'timeout', deterministic: false, attempts: 1 } });
    expect(failed[0].opts?.onlyIfStatus).toEqual(['running']);
    expect(h.recordFailed).toHaveBeenCalledWith('m-1', 'task-1', 'Task one', toolTimeoutReason);
    expect(h.recordEvent.mock.calls.some((c) => c[1] === 'execution_failed' && c[2].entityId === 'task-1')).toBe(true);
    expect(h.emit.mock.calls.some((c) => c[0].eventType === 'failed' && c[0].taskId === 'task-1')).toBe(true);
  });

  it('task 1 hangs in the tool step: it fails at 60 s without a retry, task 2 still runs, the mission rollup runs for both', async () => {
    h.decide.mockImplementation(async (text: string) => (text.includes('Task one') ? never() : answer));
    const p = executeMissionTasks(mission, [task1, task2], [], undefined);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(130_000);

    expect(s.done).toBe(true);
    const results = await p;
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe(toolTimeoutReason);
    expect(results[1].status).toBe('completed');
    expect(h.decide).toHaveBeenCalledTimes(2); // once per task — never a second call for task 1
    expect(h.recalc).toHaveBeenCalledTimes(2);
  });

  it('a late SUCCESSFUL tool result after the failure was written produces no status write, no timeline write and no second decideTools call', async () => {
    let release!: (v: unknown) => void;
    h.decide.mockImplementation(() => new Promise((r) => { release = r; }));
    const p = executeTask(task1, mission, null, []);
    await vi.advanceTimersByTimeAsync(70_000);
    const result = await p;
    expect(result.status).toBe('failed');

    const writesBefore = h.updateTask.mock.calls.length;
    const eventsBefore = h.recordEvent.mock.calls.length;
    const completedBefore = h.recordCompleted.mock.calls.length;
    release(answer); // the abandoned tool call finally "succeeds"
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.updateTask.mock.calls.length).toBe(writesBefore);
    expect(h.recordEvent.mock.calls.length).toBe(eventsBefore);
    expect(h.recordCompleted.mock.calls.length).toBe(completedBefore);
    expect(writes('task-1').some((w) => w.patch.status === 'completed')).toBe(false);
    expect(h.decide).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('late tool-step result discarded after timeout'))).toBe(true);
  });

  it('the NON-tool steps are still retried by the existing rules (a settings load that never settles: no external side effect)', async () => {
    h.decide.mockResolvedValue({ shouldUseTool: false, selectedToolIds: [], executions: [], toolAnswer: null, success: false, outcome: 'declined_no_match', error: null });
    h.loadSettings.mockImplementationOnce(never).mockResolvedValue({ temperature: 0.7, max_tokens: 2048, active_provider: 'groq' });
    const p = executeTask(task1, mission, null, []);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(70_000);

    expect(s.done).toBe(true);
    const result = await p;
    expect(result.status).toBe('completed');
    expect(h.loadSettings).toHaveBeenCalledTimes(2);
    const retried = h.recordEvent.mock.calls.find((c) => c[1] === 'execution_retried');
    expect(retried?.[2].detail).toContain('Loading settings timed out after 60 s');
  });

  it('a model-routing step that never settles is retried too', async () => {
    h.decide.mockResolvedValue({ shouldUseTool: false, selectedToolIds: [], executions: [], toolAnswer: null, success: false, outcome: 'declined_no_match', error: null });
    h.route.mockImplementationOnce(never).mockResolvedValue({ selected: null, candidates: [], reason: 'test', taskType: 'x', mode: 'automatic' });
    const p = executeTask(task1, mission, null, []);
    await vi.advanceTimersByTimeAsync(70_000);
    expect((await p).status).toBe('completed');
    expect(h.route).toHaveBeenCalledTimes(2);
  });
});

describe('D — hard deadline: the mission moves on, the next task still runs, the mission can settle', () => {
  it('task 1 hangs in the tool step past the hard deadline; it is failed with an honest reason, task 2 runs and completes, recalculateProgress ran for both', async () => {
    h.decide.mockImplementation(async (text: string) => (text.includes('Task one') ? never() : answer));
    const p = executeMissionTasks(mission, [task1, task2], [], undefined, { hardDeadlineMs: () => 5_000 });
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(s.done).toBe(true);
    const results = await p;
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('Task timed out after 5 s — no response from the tool decision.');
    expect(results[0].result).toMatchObject({ failure: { kind: 'timeout', deterministic: false } });
    expect(results[1].status).toBe('completed');
    // E: the mission rollup ran after EVERY task, including the one that timed out
    expect(h.recalc).toHaveBeenCalledTimes(2);
    // the failed write is conditional on the task not having finished
    const failed = terminalWrites('task-1');
    expect(failed).toHaveLength(1);
    expect(failed[0].patch).toMatchObject({ status: 'failed', errorMessage: results[0].error });
    expect(failed[0].opts?.onlyIfStatus).toEqual(['waiting', 'ready', 'running']);
    // a timeline event is attempted for the failure
    expect(h.recordFailed).toHaveBeenCalledWith('m-1', 'task-1', 'Task one', results[0].error);
    expect(h.recordEvent.mock.calls.some((c) => c[1] === 'execution_failed' && c[2].entityId === 'task-1')).toBe(true);
  });

  it('G — the timeout is logged with step, task id, mission id and elapsed ms', async () => {
    h.decide.mockImplementation(async (text: string) => (text.includes('Task one') ? never() : answer));
    const p = executeMissionTasks(mission, [task1], [], undefined, { hardDeadlineMs: () => 5_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const line = error.mock.calls.map((c) => String(c[0])).find((l) => l.includes('task timeout'));
    expect(line).toContain('task=task-1');
    expect(line).toContain('mission=m-1');
    expect(line).toContain('step="the tool decision"');
    expect(line).toMatch(/elapsed=\d+ms/);
  });

  it('a claim that never answers fails the task (bounded, 20 s) and the next task still runs', async () => {
    h.claimTask.mockImplementation((id: string) => (id === 'task-1' ? never() : Promise.resolve({ id })));
    const p = executeMissionTasks(mission, [task1, task2], [], undefined);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(s.done).toBe(true);
    const results = await p;
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('Claiming the task timed out after 20 s');
    expect(results[1].status).toBe('completed');
    expect(h.decide).toHaveBeenCalledTimes(1);
  });
});

describe('B — side-effect writes are non-fatal', () => {
  it('timeline / log / runtime-activity writes that never settle do not stop the task completing', async () => {
    h.recordEvent.mockImplementation(never);
    h.recordStarted.mockImplementation(never);
    h.recordCompleted.mockImplementation(never);
    h.appendLog.mockImplementation(never);
    h.emit.mockImplementation(never);
    const p = executeTask(task1, mission, null, []);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(15_000 * 12);

    expect(s.done).toBe(true);
    const result = await p;
    expect(result.status).toBe('completed');
    expect(writes('task-1').some((w) => w.patch.status === 'completed')).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[swarm] timeline event tool_decision_outcome timed out'))).toBe(true);
  });

  it('a timeline write that REJECTS is logged and ignored (it used to fail the attempt)', async () => {
    h.recordEvent.mockRejectedValue(new Error('rls'));
    const result = await executeTask(task1, mission, null, []);
    expect(result.status).toBe('completed');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('timeline event tool_decision_outcome failed: rls'))).toBe(true);
  });
});

describe('B — a hung FINAL status write is bounded', () => {
  it('the completed write is retried once, then abandoned with an error naming the task; the pipeline carries on to task 2', async () => {
    h.updateTask.mockImplementation((id: string, patch: { status?: string }) => (id === 'task-1' && patch.status === 'completed' ? never() : Promise.resolve({ id })));
    const p = executeMissionTasks(mission, [task1, task2], [], undefined);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(200_000);

    expect(s.done).toBe(true);
    const results = await p;
    expect(results[1].status).toBe('completed');
    expect(writes('task-1').filter((w) => w.patch.status === 'completed')).toHaveLength(2); // attempt + one retry
    const line = error.mock.calls.map((c) => String(c[0])).find((l) => l.includes('task completed could not be written'));
    expect(line).toContain('task=task-1');
    expect(h.recalc).toHaveBeenCalledTimes(2);
  });

  it('a hung mission rollup (recalculateProgress) is bounded too and the loop finishes', async () => {
    h.recalc.mockImplementation(never);
    const p = executeMissionTasks(mission, [task1, task2], [], undefined);
    const s = settled(p);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(s.done).toBe(true);
    expect((await p).map((r) => r.status)).toEqual(['completed', 'completed']);
    expect(error.mock.calls.some((c) => String(c[0]).includes('mission status rollup could not be written'))).toBe(true);
  });
});

describe('D — late-completion guard', () => {
  it('layer 1 (in-process flag): the abandoned run resolves later with success and writes NOTHING more; the final state stays timed out', async () => {
    let release!: (v: unknown) => void;
    h.decide.mockImplementation((text: string) => (text.includes('Task one') ? new Promise((r) => { release = r; }) : Promise.resolve(answer)));
    const p = executeMissionTasks(mission, [task1, task2], [], undefined, { hardDeadlineMs: () => 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(terminalWrites('task-1').map((w) => w.patch.status)).toEqual(['failed']);

    release(answer); // the original promise finally succeeds
    await vi.advanceTimersByTimeAsync(30_000);
    await p;

    expect(terminalWrites('task-1').map((w) => w.patch.status)).toEqual(['failed']); // still exactly one terminal write
    expect(writes('task-1').some((w) => w.patch.status === 'completed')).toBe(false);
    // and it did not narrate a success it no longer owns
    expect(h.recordCompleted.mock.calls.some((c) => c[1] === 'task-1')).toBe(false);
    expect(h.recordEvent.mock.calls.some((c) => c[1] === 'execution_finished' && c[2].entityId === 'task-1')).toBe(false);
  });

  it('layer 2 (database): even a run that was NOT flagged cannot flip a task that is no longer running — the UPDATE is conditional', async () => {
    const row = { status: 'running' };
    h.updateTask.mockImplementation(async (id: string, patch: { status?: string }, opts?: { onlyIfStatus?: string[] }) => {
      if (opts?.onlyIfStatus && !opts.onlyIfStatus.includes(row.status)) return null;
      if (patch.status) row.status = patch.status;
      return { id };
    });
    h.decide.mockImplementation(async () => { row.status = 'failed'; return answer; }); // someone else failed it meanwhile
    const result = await executeTask(task1, mission, null, [], createTaskRunGuard());

    expect(row.status).toBe('failed');
    expect(result.status).toBe('completed'); // the in-memory result is the run's own; the stored state is what counts
    expect(warn.mock.calls.some((c) => String(c[0]).includes('task completed did not apply'))).toBe(true);
    expect(writes('task-1').find((w) => w.patch.status === 'completed')?.opts?.onlyIfStatus).toEqual(['running']);
  });
});

describe('E — the mission settles with an honest outcome', () => {
  const row = (id: string, status: string, errorMessage: string | null = null) => ({
    id, title: id, status, errorMessage, result: {}, assignedManager: 'nova', assignedWorker: null, retries: 0, startedAt: null, completedAt: null,
  }) as never;
  const timedOut = 'Task timed out after 180 s — no response from the tool decision.';

  it('one task timed out and one succeeded -> partial, with the reason shown', () => {
    const done = { ...(row('b', 'completed') as object), result: { output: 'A real answer.' } } as never;
    const o = computeMissionOutcome([row('a', 'failed', timedOut), done]);
    expect(o.status).toBe('partial');
    expect(o.progress).toBe(100);
    expect(o.parts.failed[0].reason).toBe(timedOut);
  });

  it('both timed out -> failed', () => {
    const o = computeMissionOutcome([row('a', 'failed', timedOut), row('b', 'failed', timedOut)]);
    expect(o.status).toBe('failed');
    expect(o.counts.failed).toBe(2);
  });

  it('the reason reads cleanly through cleanReason (no JSON, no stack)', () => {
    expect(cleanReason(timedOut)).toBe(timedOut);
  });

  it('a mission whose only task is still running is NOT settled (this was the live bug)', () => {
    expect(computeMissionOutcome([row('a', 'running'), row('b', 'ready')]).status).toBe('in_progress');
  });
});

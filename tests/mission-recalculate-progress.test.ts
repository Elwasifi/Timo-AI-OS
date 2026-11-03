// M7-13c-2b-1: recalculateProgress() is the ONLY place that decides a mission's terminal status (via
// computeMissionOutcome). 'partial' is not a DB value yet, so a partial outcome is stored as DB status 'completed' with
// the full outcome in missions.metadata.outcome (merged, other keys preserved). The terminal transition is claimed
// once. Real missionEngine + real outcome function; the database layer and timeline are stubbed (no network).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  mission: null as Record<string, any> | null,
  tasks: [] as Array<Record<string, any>>,
  claim: true,
  calls: [] as string[],
}));

vi.mock('@/lib/swarm/missionService', () => ({
  getFullMission: vi.fn(async () => ({ mission: h.mission, tasks: h.tasks, objectives: [] })),
  updateMission: vi.fn(async (_id: string, patch: Record<string, unknown>) => { h.calls.push('updateMission:' + JSON.stringify(patch)); return null; }),
  claimMissionTerminalStatus: vi.fn(async (_id: string, status: string, progress: number) => { h.calls.push(`claim:${status}:${progress}`); return h.claim; }),
  recordLesson: vi.fn(async (l: Record<string, unknown>) => { h.calls.push('lesson:' + l.category + ':' + l.outcome); }),
  createMission: vi.fn(), createObjectives: vi.fn(), createTasks: vi.fn(), getTasks: vi.fn(), updateTask: vi.fn(), updateObjective: vi.fn(), appendExecutionLog: vi.fn(),
}));
vi.mock('@/lib/swarm/missionTimeline', () => ({
  recordMissionCreated: vi.fn(), recordMissionPlanned: vi.fn(), recordObjectivesGenerated: vi.fn(), recordTasksCreated: vi.fn(),
  recordTaskStarted: vi.fn(), recordTaskCompleted: vi.fn(), recordTaskFailed: vi.fn(), recordMissionCancelled: vi.fn(),
  recordMissionCompleted: vi.fn(async () => { h.calls.push('timeline:completed'); }),
  recordMissionFailed: vi.fn(async (_id: string, _t: string, detail: string) => { h.calls.push('timeline:failed:' + detail); }),
}));
vi.mock('@/lib/swarm/missionPlanner', () => ({ planMission: vi.fn(), estimatePriority: vi.fn(), classifyComplexity: vi.fn() }));
vi.mock('@/lib/swarm/swarmManager', () => ({ dispatchTasks: vi.fn() }));
vi.mock('@/lib/governance/entitlements', () => ({ checkEntitlement: vi.fn(), consumeProjectSlot: vi.fn(), checkBudget: vi.fn() }));

import { recalculateProgress } from '@/lib/swarm/missionEngine';

const SIM_NOTE = 'Simulated execution of "gmail.send" — no real external action was taken.';
let n = 0;
const t = (status: string, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, title: `Task ${n}`, status, errorMessage: null, result: null, assignedManager: 'nova', assignedWorker: null, retries: 0, ...extra });
const real = () => t('completed', { result: { output: 'ok' } });
const sim = (mode = 'sandbox') => t('completed', { result: { output: SIM_NOTE, simulated: true, executionMode: mode } });
const bad = (msg = 'boom') => t('failed', { errorMessage: msg });

beforeEach(() => {
  h.mission = { id: 'm1', title: 'Test mission', status: 'executing', tenantId: 'tenant-1', metadata: { launchedBy: 'chat', keep: { nested: true } } };
  h.tasks = [];
  h.claim = true;
  h.calls = [];
  n = 0;
});

const metadataWrite = () => {
  const c = h.calls.find((x) => x.startsWith('updateMission:') && x.includes('"metadata"'));
  return c ? (JSON.parse(c.slice('updateMission:'.length)).metadata as Record<string, any>) : null;
};

describe('terminal status is decided from the outcome and written ONCE', () => {
  it('every task succeeded -> DB completed, progress 100, outcome completed, no lesson', async () => {
    h.tasks = [real(), real()];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:completed:100']);
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'completed', simulatedTag: false, counts: { total: 2, succeeded: 2 } });
    expect(h.calls).toContain('timeline:completed');
    expect(h.calls.some((c) => c.startsWith('lesson:'))).toBe(false);
  });

  it('PARTIAL: stored as DB status completed + metadata.outcome.status = partial, and a partial_failure lesson', async () => {
    h.tasks = [real(), bad('Gemini limit reached.')];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:completed:100']);
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'partial', counts: { succeeded: 1, failed: 1 } });
    expect(h.calls).toContain('timeline:completed');
    expect(h.calls).toContain('lesson:partial_failure:partial');
  });

  it('0 of 2 succeeded -> DB failed, outcome failed, a failure lesson and a failed timeline event naming the count', async () => {
    h.tasks = [bad(), bad()];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:failed:100']);
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'failed', counts: { failed: 2, succeeded: 0 } });
    expect(h.calls).toContain('timeline:failed:2 of 2 tasks failed');
    expect(h.calls).toContain('lesson:mission_failure:failure');
    expect(h.calls).not.toContain('timeline:completed');
  });

  it('intended-simulated tasks count as completed and the outcome carries the Simulated tag', async () => {
    h.tasks = [sim(), real()];
    await recalculateProgress('m1');
    expect(h.calls).toContain('claim:completed:100');
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'completed', simulatedTag: true, counts: { simulated: 1, succeeded: 1 } });
  });

  it('a simulated result in LIVE mode is NOT a success: a lone one makes the mission failed', async () => {
    h.tasks = [sim('live')];
    await recalculateProgress('m1');
    expect(h.calls).toContain('claim:failed:100');
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'failed', counts: { anomalous: 1, simulated: 0 } });
  });

  it('metadata is MERGED: every other key survives, outcome is added', async () => {
    h.tasks = [real()];
    await recalculateProgress('m1');
    const md = metadataWrite()!;
    expect(md.launchedBy).toBe('chat');
    expect(md.keep).toEqual({ nested: true });
    expect(md.outcome.status).toBe('completed');
    expect(typeof md.outcome.computedAt).toBe('string');
  });

  it('if another caller already claimed the terminal transition, nothing else is written (no metadata, no events, no lessons)', async () => {
    h.claim = false;
    h.tasks = [real(), bad()];
    await recalculateProgress('m1');
    expect(h.calls).toEqual(['claim:completed:100']);
  });

  it('calling it twice for a finished mission runs the side effects only once (the second claim loses)', async () => {
    h.tasks = [bad(), bad()];
    await recalculateProgress('m1');
    h.claim = false;
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('timeline:failed')).length).toBe(1);
    expect(h.calls.filter((c) => c.startsWith('lesson:')).length).toBe(1);
  });
});

describe('not finished / not ours', () => {
  it('open tasks: no terminal claim; status unchanged; progress = resolved / total', async () => {
    h.tasks = [real(), t('ready'), t('awaiting_approval'), bad()];
    await recalculateProgress('m1');
    expect(h.calls.some((c) => c.startsWith('claim:'))).toBe(false);
    expect(h.calls).toEqual([`updateMission:${JSON.stringify({ progress: 50, status: 'executing' })}`]);
  });

  it('an already-cancelled mission is left alone (cancelMission wrote everything)', async () => {
    h.mission = { ...h.mission!, status: 'cancelled' };
    h.tasks = [t('cancelled'), t('cancelled')];
    await recalculateProgress('m1');
    expect(h.calls).toEqual([]);
  });

  it('no tasks / unknown mission: nothing happens', async () => {
    h.tasks = [];
    await recalculateProgress('m1');
    h.mission = null;
    h.tasks = [real()];
    await recalculateProgress('m1');
    expect(h.calls).toEqual([]);
  });
});

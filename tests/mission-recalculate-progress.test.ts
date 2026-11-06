// M7-13c-2b-1: recalculateProgress() is the ONLY place that decides a mission's terminal status (via
// computeMissionOutcome). a partial outcome is stored as DB status 'partial' (migration 20261106120000; M7-13c-2b-2b) with
// the full outcome in missions.metadata.outcome (merged, other keys preserved) plus the 'mission_partial' event; a DB that rejects the label gets the old 'completed' storage. The terminal transition is claimed
// once. Real missionEngine + real outcome function; the database layer and timeline are stubbed (no network).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  mission: null as Record<string, any> | null,
  tasks: [] as Array<Record<string, any>>,
  claim: true,
  claimThrows: null as unknown,
  calls: [] as string[],
}));

vi.mock('@/lib/swarm/missionService', () => ({
  getFullMission: vi.fn(async () => ({ mission: h.mission, tasks: h.tasks, objectives: [] })),
  updateMission: vi.fn(async (_id: string, patch: Record<string, unknown>) => { h.calls.push('updateMission:' + JSON.stringify(patch)); return null; }),
  claimMissionTerminalStatus: vi.fn(async (_id: string, status: string, progress: number) => { h.calls.push(`claim:${status}:${progress}`); if (h.claimThrows && status === 'partial') throw h.claimThrows; return h.claim; }),
  recordLesson: vi.fn(async (l: Record<string, unknown>) => { h.calls.push('lesson:' + l.category + ':' + l.outcome); }),
  getTasks: vi.fn(async () => h.tasks),
  updateTask: vi.fn(async (id: string, patch: Record<string, unknown>) => { h.calls.push(`updateTask:${id}:${patch.status}`); return null; }),
  updateObjective: vi.fn(async (id: string, patch: Record<string, unknown>) => { h.calls.push(`objective:${id}:${patch.status}`); }),
  createMission: vi.fn(), createObjectives: vi.fn(), createTasks: vi.fn(), appendExecutionLog: vi.fn(),
}));
vi.mock('@/lib/swarm/missionTimeline', () => ({
  recordMissionCreated: vi.fn(), recordMissionPlanned: vi.fn(), recordObjectivesGenerated: vi.fn(), recordTasksCreated: vi.fn(),
  recordTaskStarted: vi.fn(), recordTaskCompleted: vi.fn(), recordTaskFailed: vi.fn(), recordMissionCancelled: vi.fn(async () => { h.calls.push('timeline:cancelled'); }),
  recordMissionPartial: vi.fn(async (_id: string, _t: string, detail: string) => { h.calls.push('timeline:partial:' + detail); }),
  recordMissionCompleted: vi.fn(async () => { h.calls.push('timeline:completed'); }),
  recordMissionFailed: vi.fn(async (_id: string, _t: string, detail: string) => { h.calls.push('timeline:failed:' + detail); }),
}));
vi.mock('@/lib/swarm/missionPlanner', () => ({ planMission: vi.fn(), estimatePriority: vi.fn(), classifyComplexity: vi.fn() }));
vi.mock('@/lib/swarm/swarmManager', () => ({ dispatchTasks: vi.fn() }));
vi.mock('@/lib/governance/entitlements', () => ({ checkEntitlement: vi.fn(), consumeProjectSlot: vi.fn(), checkBudget: vi.fn() }));

import { recalculateProgress, recalculateObjectiveStatus, cancelMission } from '@/lib/swarm/missionEngine';

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
  h.claimThrows = null;
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

  it('PARTIAL: stored as DB status partial + metadata.outcome.status = partial, the mission_partial event (NOT mission_completed), and a partial_failure lesson', async () => {
    h.tasks = [real(), bad('Gemini limit reached.')];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:partial:100']);
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'partial', counts: { succeeded: 1, failed: 1 } });
    expect(h.calls).toContain('timeline:partial:1 of 2 tasks did not succeed');
    expect(h.calls).not.toContain('timeline:completed');
    expect(h.calls).toContain('lesson:partial_failure:partial');
  });

  it('the lessons-learned behaviour for partial is unchanged: ONE partial_failure lesson (summary names the not-succeeded count, detail lists the failed task errors), none for a clean run', async () => {
    h.tasks = [real(), bad('Gemini limit reached.')];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('lesson:'))).toEqual(['lesson:partial_failure:partial']);
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
    expect(h.calls).toEqual(['claim:partial:100']);
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

describe("SAFETY NET: the database rejects the 'partial' label (an environment without migration 20261106120000)", () => {
  const enumError = () => Object.assign(new Error('invalid input value for enum mission_status: "partial"'), { code: '22P02' });

  it('falls back to the old storage — status completed + metadata.outcome partial + mission_completed — and logs a clear [swarm] line, so the mission still settles', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.claimThrows = enumError();
    h.tasks = [real(), bad('Gemini limit reached.')];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:partial:100', 'claim:completed:100']);
    expect(metadataWrite()?.outcome).toMatchObject({ status: 'partial', counts: { succeeded: 1, failed: 1 } });
    expect(h.calls).toContain('timeline:completed');
    expect(h.calls.some((c) => c.startsWith('timeline:partial'))).toBe(false);
    expect(h.calls).toContain('lesson:partial_failure:partial');
    expect(err.mock.calls.some((c) => String(c[0]).startsWith("[swarm] mission_status 'partial' rejected by the database") && String(c[0]).includes('falling back'))).toBe(true);
    err.mockRestore();
  });

  it('any OTHER error from the claim is not swallowed', async () => {
    h.claimThrows = Object.assign(new Error('connection reset'), { code: '08006' });
    h.tasks = [real(), bad()];
    await expect(recalculateProgress('m1')).rejects.toThrow('connection reset');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:partial:100']);
  });

  it('the fallback is only for partial: a failed / completed outcome never retries with another status', async () => {
    h.tasks = [bad(), bad()];
    await recalculateProgress('m1');
    expect(h.calls.filter((c) => c.startsWith('claim:'))).toEqual(['claim:failed:100']);
  });
});

describe('cancelMission on a settled mission is a no-op', () => {
  it.each(['partial', 'completed', 'failed', 'cancelled'])('%s: refused, nothing is written (no task cancelled, no mission update, no event)', async (status) => {
    h.mission = { ...h.mission!, status };
    h.tasks = [real(), bad()];
    const r = await cancelMission('m1', 'tenant-1');
    expect(r).toEqual({ success: false, error: `Mission is already ${status}` });
    expect(h.calls).toEqual([]);
  });

  it('a running mission can still be cancelled (open tasks cancelled, mission cancelled, event recorded)', async () => {
    h.tasks = [real(), t('ready'), t('running')];
    const r = await cancelMission('m1', 'tenant-1');
    expect(r.success).toBe(true);
    expect(h.calls).toContain('updateTask:t2:cancelled');
    expect(h.calls).toContain('updateTask:t3:cancelled');
    expect(h.calls).toContain('timeline:cancelled');
  });
});

describe('recalculateObjectiveStatus counts a skipped task as resolved', () => {
  const o = (status: string) => t(status, { objectiveId: 'o1' });
  it('completed + skipped -> the objective is completed (a skipped task never runs; it must not keep it in_progress for ever)', async () => {
    h.tasks = [o('completed'), o('skipped')];
    await recalculateObjectiveStatus('m1', 'o1');
    expect(h.calls).toEqual(['objective:o1:completed']);
  });
  it('failed + skipped, and only-skipped -> failed (nothing under it succeeded)', async () => {
    h.tasks = [o('failed'), o('skipped')];
    await recalculateObjectiveStatus('m1', 'o1');
    h.tasks = [o('skipped'), o('skipped')];
    await recalculateObjectiveStatus('m1', 'o1');
    expect(h.calls).toEqual(['objective:o1:failed', 'objective:o1:failed']);
  });
  it('an open task keeps it in_progress even with skipped ones', async () => {
    h.tasks = [o('completed'), o('skipped'), o('ready')];
    await recalculateObjectiveStatus('m1', 'o1');
    expect(h.calls).toEqual(['objective:o1:in_progress']);
  });
});

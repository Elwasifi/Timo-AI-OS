// M7-13c-2b-2b (delta): the 'partial' safety net must work in an environment whose mission_status enum LACKS 'partial'.
// The fake database below behaves like Postgres there: it throws 22P02 whenever the label 'partial' appears as a WRITTEN
// value OR inside any filter literal (a negative guard naming 'partial' is rejected for EVERY claim). The REAL
// claimMissionTerminalStatus + the REAL recalculateProgress run against it; only reads, the timeline and lessons are stubbed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  row: { id: 'm1', status: 'executing' } as { id: string; status: string },
  mission: null as Record<string, any> | null,
  tasks: [] as Array<Record<string, any>>,
  calls: [] as string[],
  enumHasPartial: false,
}));

const enumError = () => ({ code: '22P02', message: 'invalid input value for enum mission_status: "partial"' });

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    const ops: Array<{ name: string; args: unknown[] }> = [];
    const b: any = new Proxy({}, {
      get: (_t, name: string) => {
        if (name === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const update = ops.find((o) => o.name === 'update')?.args[0] as Record<string, unknown> | undefined;
            const filters = ops.filter((o) => o.name === 'in' || o.name === 'not');
            const mentionsPartial = JSON.stringify(filters.map((f) => f.args)).includes('partial');
            let out: { data: unknown; error: unknown };
            if (table !== 'missions' || !update) out = { data: null, error: null };
            else if (!h.enumHasPartial && (update.status === 'partial' || mentionsPartial)) out = { data: null, error: enumError() };
            else {
              const inList = ops.find((o) => o.name === 'in')?.args[1] as string[] | undefined;
              const notList = ops.find((o) => o.name === 'not')?.args[2] as string | undefined;
              const matches = (inList ? inList.includes(h.row.status) : true) && (notList ? !notList.replace(/[()]/g, '').split(',').includes(h.row.status) : true);
              if (matches) { h.row.status = update.status as string; out = { data: { id: h.row.id }, error: null }; }
              else out = { data: null, error: null };
            }
            return Promise.resolve(out).then(res, rej);
          };
        }
        return (...args: unknown[]) => { ops.push({ name, args }); return b; };
      },
    });
    return b;
  };
  return { supabase: { from } };
});

vi.mock('@/lib/swarm/missionService', async (orig) => {
  const actual = await orig<typeof import('@/lib/swarm/missionService')>();
  return {
    ...actual, // the REAL claimMissionTerminalStatus
    getFullMission: vi.fn(async () => ({ mission: h.mission, tasks: h.tasks, objectives: [] })),
    updateMission: vi.fn(async (_id: string, patch: Record<string, unknown>) => { h.calls.push('updateMission:' + JSON.stringify(patch)); return null; }),
    recordLesson: vi.fn(async (l: Record<string, unknown>) => { h.calls.push('lesson:' + l.category); }),
  };
});
vi.mock('@/lib/swarm/missionTimeline', () => ({
  recordMissionCreated: vi.fn(), recordMissionPlanned: vi.fn(), recordObjectivesGenerated: vi.fn(), recordTasksCreated: vi.fn(),
  recordTaskStarted: vi.fn(), recordTaskCompleted: vi.fn(), recordTaskFailed: vi.fn(), recordMissionCancelled: vi.fn(),
  recordMissionPartial: vi.fn(async () => { h.calls.push('timeline:partial'); }),
  recordMissionCompleted: vi.fn(async () => { h.calls.push('timeline:completed'); }),
  recordMissionFailed: vi.fn(async () => { h.calls.push('timeline:failed'); }),
}));
vi.mock('@/lib/swarm/missionPlanner', () => ({ planMission: vi.fn(), estimatePriority: vi.fn(), classifyComplexity: vi.fn() }));
vi.mock('@/lib/swarm/swarmManager', () => ({ dispatchTasks: vi.fn() }));
vi.mock('@/lib/governance/entitlements', () => ({ checkEntitlement: vi.fn(), consumeProjectSlot: vi.fn(), checkBudget: vi.fn() }));

import { recalculateProgress } from '@/lib/swarm/missionEngine';

let n = 0;
const t = (status: string, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, title: `Task ${n}`, status, errorMessage: null, result: null, assignedManager: 'nova', assignedWorker: null, retries: 0, ...extra });
const real = () => t('completed', { result: { output: 'ok' } });
const bad = () => t('failed', { errorMessage: 'boom' });
const metadataOutcome = () => {
  const c = h.calls.find((x) => x.startsWith('updateMission:') && x.includes('"metadata"'));
  return c ? JSON.parse(c.slice('updateMission:'.length)).metadata.outcome : null;
};

beforeEach(() => {
  n = 0;
  h.row = { id: 'm1', status: 'executing' };
  h.mission = { id: 'm1', title: 'Test mission', status: 'executing', tenantId: 't', metadata: {} };
  h.tasks = [];
  h.calls = [];
  h.enumHasPartial = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("environment WITHOUT the 'partial' label", () => {
  it("a partial outcome falls back: the mission settles as 'completed' + metadata.outcome 'partial' + the mission_completed event", async () => {
    h.tasks = [real(), bad()];
    await recalculateProgress('m1');
    expect(h.row.status).toBe('completed');
    expect(metadataOutcome()).toMatchObject({ status: 'partial' });
    expect(h.calls).toContain('timeline:completed');
    expect(h.calls).not.toContain('timeline:partial');
    expect(h.calls).toContain('lesson:partial_failure');
  });

  it('a plain failed mission and a plain completed mission still settle (the claim filter is valid there)', async () => {
    h.tasks = [bad(), bad()];
    await recalculateProgress('m1');
    expect(h.row.status).toBe('failed');
    h.row = { id: 'm1', status: 'executing' };
    h.calls = [];
    h.tasks = [real(), real()];
    await recalculateProgress('m1');
    expect(h.row.status).toBe('completed');
    expect(h.calls).toContain('timeline:completed');
  });

  it('a settled mission is still never overwritten (completed stays completed)', async () => {
    h.row = { id: 'm1', status: 'completed' };
    h.tasks = [bad(), bad()];
    await recalculateProgress('m1');
    expect(h.row.status).toBe('completed');
    expect(h.calls.some((c) => c.startsWith('timeline:'))).toBe(false);
  });
});

describe("environment WITH the 'partial' label (the migrated database)", () => {
  beforeEach(() => { h.enumHasPartial = true; });

  it("a partial outcome is stored as 'partial' with the mission_partial event; a settled partial mission is never overwritten", async () => {
    h.tasks = [real(), bad()];
    await recalculateProgress('m1');
    expect(h.row.status).toBe('partial');
    expect(h.calls).toContain('timeline:partial');
    expect(h.calls).not.toContain('timeline:completed');
    h.calls = [];
    h.tasks = [bad(), bad()]; // a later rollup that would now say "failed"
    await recalculateProgress('m1');
    expect(h.row.status).toBe('partial');
    expect(h.calls.some((c) => c.startsWith('timeline:'))).toBe(false);
  });
});

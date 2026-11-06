// M7-13c-2b-2b: the readers that enumerate mission / task statuses must treat 'partial' and 'skipped' correctly:
//   - dashboard summaries count them (totals add up);
//   - the GBrain graph treats a partial mission as FINISHED (not active) and lists it with the recently finished ones.
// No database: the data layer is stubbed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  missions: [] as Array<Record<string, unknown>>,
  tasks: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/swarm/missionService', () => ({
  listMissions: vi.fn(async () => h.missions),
  getMission: vi.fn(),
  getTasks: vi.fn(async () => h.tasks),
  getTasksForMissions: vi.fn(async () => h.tasks),
  getTimeline: vi.fn(),
  getFullMission: vi.fn(),
}));
vi.mock('@/lib/swarm/runtimeStore', () => ({
  getRuntimeState: vi.fn(async () => ({ currentMissionId: 'm1' })),
  getRuntimeStateForTenant: vi.fn(async () => ({ currentMissionId: 'm1' })),
  getRuntimeActivity: vi.fn(),
  getRuntimeActivityForTenant: vi.fn(),
}));

import { getMissionSummary, getTaskQueueSummary } from '@/lib/dashboard/dashboardService';
import { normalizeMissions } from '@/lib/gbrain/graph-builder';

const mission = (id: string, status: string, progress = 100) => ({ id, title: `Mission ${id}`, status, progress, estimatedTasks: 2, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
const task = (id: string, status: string, missionId = 'm1') => ({ id, missionId, status });

beforeEach(() => {
  h.missions = [];
  h.tasks = [];
});

describe('dashboard summaries', () => {
  it('the mission summary counts partial, and every bucket adds up to the total', async () => {
    h.missions = [mission('a', 'completed'), mission('b', 'partial'), mission('c', 'partial'), mission('d', 'failed'), mission('e', 'cancelled'), mission('f', 'executing', 50), mission('g', 'paused', 10)];
    const s = await getMissionSummary();
    expect(s.partial).toBe(2);
    expect(s.completed).toBe(1);
    expect(s.total).toBe(7);
    expect(s.running + s.completed + s.failed + s.cancelled + s.partial + s.paused).toBe(s.total);
  });

  it('the task summary counts skipped, and every bucket adds up to the total', async () => {
    h.tasks = [task('1', 'completed'), task('2', 'skipped'), task('3', 'skipped'), task('4', 'failed'), task('5', 'cancelled'), task('6', 'ready'), task('7', 'waiting'), task('8', 'running')];
    const s = await getTaskQueueSummary();
    expect(s.skipped).toBe(2);
    expect(s.total).toBe(8);
    expect(s.waiting + s.ready + s.running + s.completed + s.failed + s.cancelled + s.skipped).toBe(s.total);
  });
});

describe('GBrain graph: a partial mission is finished, not active', () => {
  it('a partial mission is NOT in the active list: an executing one is shown instead, the partial one is not', () => {
    const out = normalizeMissions([mission('p', 'partial'), mission('x', 'executing', 40)] as never, []);
    expect(out.map((m) => m.id)).toEqual(['x']);
    expect(out[0].status).toBe('running');
  });

  it('with nothing active, partial missions appear in the recently-finished list (as finished, not error)', () => {
    const out = normalizeMissions([mission('p', 'partial'), mission('f', 'failed'), mission('c', 'completed')] as never, []);
    expect(out.map((m) => [m.id, m.status])).toEqual([['p', 'idle'], ['f', 'error']]);
  });

  it('a partial mission alone is listed as finished (idle) rather than falling into the active branch', () => {
    const out = normalizeMissions([mission('p', 'partial')] as never, []);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('idle');
    expect(out[0].lastRun).not.toBe('Running now');
  });
});

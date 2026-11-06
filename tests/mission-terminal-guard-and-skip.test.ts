// M7-13c-2b-2b: the two database-facing pieces of the new states, against a recording fake of the Supabase query builder
// (no network, no real database):
//   - claimMissionTerminalStatus: 'partial' is a terminal status — a settled partial mission is never overwritten by a
//     later rollup — and it is the ONLY place an invalid-enum rejection of 'partial' is rethrown (for the fallback);
//   - skipTask / skipOpenTasks: only a task in an open PRE-RUN status (waiting / ready) can become 'skipped', via a
//     conditional UPDATE; running / terminal tasks are never touched; a 'task_skipped' timeline event is recorded.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { table: string; name: string; args: unknown[] };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; name: string; args: unknown[] }>,
  respond: (_table: string, _calls: Array<{ name: string; args: unknown[] }>): { data: unknown; error: unknown } => ({ data: null, error: null }),
}));

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    const own: Array<{ name: string; args: unknown[] }> = [];
    const b: any = new Proxy({}, {
      get: (_t, name: string) => {
        if (name === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.respond(table, own)).then(res, rej);
        return (...args: unknown[]) => { own.push({ name, args }); h.calls.push({ table, name, args }); return b; };
      },
    });
    return b;
  };
  return { supabase: { from } };
});

import { claimMissionTerminalStatus, skipTask, skipOpenTasks, SKIPPABLE_TASK_STATUSES } from '@/lib/swarm/missionService';

const taskRow = (id: string, status = 'skipped') => ({
  id, mission_id: 'm-1', objective_id: null, parent_task_id: null, assigned_manager: 'nova', assigned_worker: null,
  required_capability: 'x', title: `Task ${id}`, description: 'd', priority: 'medium', status, dependencies: [], retries: 0,
  max_retries: 3, execution_log: [], result: null, error_message: 'Stale', created_at: 't', updated_at: 't', started_at: null,
  completed_at: 't', max_loop_steps: null, loop_state: null,
});
const timelineRow = { id: 'tl', mission_id: 'm-1', event_type: 'task_skipped', entity_type: 'task', entity_id: 't1', title: 'x', detail: '', metadata: {}, created_at: 't' };

const on = (table: string) => h.calls.filter((c: Call) => c.table === table);
const callsNamed = (table: string, name: string) => on(table).filter((c: Call) => c.name === name);

beforeEach(() => {
  h.calls = [];
  h.respond = () => ({ data: null, error: null });
});

describe('claimMissionTerminalStatus', () => {
  it("the guard is a POSITIVE list of non-terminal statuses: it never names partial / completed / failed / cancelled, and has no negative filter", async () => {
    h.respond = () => ({ data: { id: 'm-1' }, error: null });
    await claimMissionTerminalStatus('m-1', 'failed', 100);
    expect(callsNamed('missions', 'not')).toHaveLength(0);
    const guard = callsNamed('missions', 'in')[0];
    expect(guard.args[0]).toBe('status');
    expect(guard.args[1]).toEqual(['pending', 'planning', 'ready', 'executing', 'reviewing', 'paused']);
    for (const terminal of ['partial', 'completed', 'failed', 'cancelled']) expect(guard.args[1]).not.toContain(terminal);
  });

  it.each(['completed', 'failed', 'cancelled', 'partial'])('a mission already %s is not claimable: the conditional filter excludes it (never overwritten by a later rollup)', async (settled) => {
    h.respond = () => ({ data: { id: 'm-1' }, error: null });
    await claimMissionTerminalStatus('m-1', 'failed', 100);
    const allowed = callsNamed('missions', 'in')[0].args[1] as string[];
    expect(allowed.includes(settled)).toBe(false);
  });

  it("writes the 'partial' status and returns true when the transition was claimed; false when another caller got there first", async () => {
    h.respond = () => ({ data: { id: 'm-1' }, error: null });
    expect(await claimMissionTerminalStatus('m-1', 'partial', 100)).toBe(true);
    expect(callsNamed('missions', 'update')[0].args[0]).toEqual({ status: 'partial', progress: 100 });
    h.respond = () => ({ data: null, error: null }); // the guarded UPDATE matched no row
    expect(await claimMissionTerminalStatus('m-1', 'partial', 100)).toBe(false);
  });

  it("rethrows ONLY the invalid-enum rejection of 'partial' (so recalculateProgress can fall back); every other error stays a plain false", async () => {
    const enumErr = { code: '22P02', message: 'invalid input value for enum mission_status: "partial"' };
    h.respond = () => ({ data: null, error: enumErr });
    await expect(claimMissionTerminalStatus('m-1', 'partial', 100)).rejects.toBe(enumErr);
    // the same error for another status is not our business (it cannot be an unknown label of ours): plain false
    expect(await claimMissionTerminalStatus('m-1', 'completed', 100)).toBe(false);
    h.respond = () => ({ data: null, error: { code: '08006', message: 'connection reset' } });
    expect(await claimMissionTerminalStatus('m-1', 'partial', 100)).toBe(false);
  });
});

describe('skipTask — conditional on an open pre-run status', () => {
  it('only waiting / ready are skippable (never running, awaiting_approval or a terminal status)', () => {
    expect(SKIPPABLE_TASK_STATUSES).toEqual(['waiting', 'ready']);
  });

  it("sets status 'skipped' with the reason via a CONDITIONAL update (.in('status', ['waiting','ready'])) and records task_skipped", async () => {
    h.respond = (table) => (table === 'mission_tasks' ? { data: taskRow('t1'), error: null } : { data: timelineRow, error: null });
    const task = await skipTask('t1', 'The mission was abandoned.');
    expect(task?.status).toBe('skipped');
    const upd = callsNamed('mission_tasks', 'update')[0].args[0] as Record<string, unknown>;
    expect(upd).toMatchObject({ status: 'skipped', error_message: 'The mission was abandoned.' });
    expect(typeof upd.completed_at).toBe('string');
    expect(callsNamed('mission_tasks', 'eq')[0].args).toEqual(['id', 't1']);
    expect(callsNamed('mission_tasks', 'in')[0].args).toEqual(['status', ['waiting', 'ready']]);
    const ev = callsNamed('mission_timeline', 'insert')[0].args[0] as Record<string, unknown>;
    expect(ev).toMatchObject({ mission_id: 'm-1', event_type: 'task_skipped', entity_type: 'task', entity_id: 't1', detail: 'The mission was abandoned.' });
  });

  it('a task that is NOT open (running / terminal) matches nothing: returns null and records NO event', async () => {
    h.respond = () => ({ data: null, error: null });
    expect(await skipTask('t-running', 'x')).toBeNull();
    expect(on('mission_timeline')).toHaveLength(0);
  });

  it('a failing write is bounded, retried once and never throws (returns null, no event)', async () => {
    h.respond = () => ({ data: null, error: { message: 'boom' } });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await skipTask('t1', 'x')).toBeNull();
    expect(callsNamed('mission_tasks', 'update')).toHaveLength(2); // boundedStatusWrite: 1 try + 1 retry
    expect(on('mission_timeline')).toHaveLength(0);
    warn.mockRestore();
  });

  it('a failing timeline write does not undo the skip (best-effort)', async () => {
    h.respond = (table) => (table === 'mission_tasks' ? { data: taskRow('t1'), error: null } : { data: null, error: { message: 'timeline down' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await skipTask('t1', 'x'))?.status).toBe('skipped');
    err.mockRestore();
  });
});

describe('skipOpenTasks — one conditional UPDATE for the mission', () => {
  it("scopes by mission AND by status ['waiting','ready'], returns the skipped tasks and records one task_skipped event each", async () => {
    h.respond = (table) => (table === 'mission_tasks' ? { data: [taskRow('t1'), taskRow('t2')], error: null } : { data: timelineRow, error: null });
    const tasks = await skipOpenTasks('m-1', 'Stale mission cleanup.');
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(callsNamed('mission_tasks', 'update')[0].args[0]).toMatchObject({ status: 'skipped', error_message: 'Stale mission cleanup.' });
    expect(callsNamed('mission_tasks', 'eq')[0].args).toEqual(['mission_id', 'm-1']);
    expect(callsNamed('mission_tasks', 'in')[0].args).toEqual(['status', ['waiting', 'ready']]);
    expect(callsNamed('mission_timeline', 'insert').map((c: Call) => (c.args[0] as Record<string, unknown>).entity_id)).toEqual(['t1', 't2']);
  });

  it('no open task -> no tasks, no events', async () => {
    h.respond = () => ({ data: [], error: null });
    expect(await skipOpenTasks('m-1', 'x')).toEqual([]);
    expect(on('mission_timeline')).toHaveLength(0);
  });

  it('a failing write returns [] and never throws', async () => {
    h.respond = () => ({ data: null, error: { message: 'boom' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await skipOpenTasks('m-1', 'x')).toEqual([]);
    err.mockRestore();
  });
});

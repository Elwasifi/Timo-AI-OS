// M7-13c-2b-3 (Part D): the stale-mission cleanup. Nothing here touches a real database.
//   - the pure rules (candidate rule, would-settle outcome, argument parsing, id validation);
//   - the settle sequence with fake dependencies (order, what is written, idempotence);
//   - the REAL missionService helpers the script uses (skipOpenTasks / failRunningTasks / claim) over a small stateful fake of the
//     Supabase builder that applies eq()/in() conditions like Postgres would, so a missing status condition overwrites rows and
//     the test sees it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  db: { missions: [] as Row[], mission_tasks: [] as Row[], runtime_activity: [] as Row[], mission_timeline: [] as Row[] } as Record<string, Row[]>,
  calls: [] as Array<{ table: string; name: string; args: unknown[] }>,
  nextId: 1,
}));

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    const ops: Array<{ name: string; args: unknown[] }> = [];
    const b: any = new Proxy({}, {
      get: (_t, name: string) => {
        if (name === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const has = (n: string) => ops.some((o) => o.name === n);
            const matches = (r: Row) => ops.every((o) => {
              if (o.name === 'eq') return r[o.args[0] as string] === o.args[1];
              if (o.name === 'in') return (o.args[1] as unknown[]).includes(r[o.args[0] as string]);
              return true;
            });
            const single = has('maybeSingle') || has('single');
            let out: { data: unknown; error: unknown };
            if (has('insert')) {
              const row = { id: `new-${h.nextId++}`, created_at: new Date().toISOString(), ...(ops.find((o) => o.name === 'insert')!.args[0] as Row) };
              h.db[table].push(row);
              out = { data: single ? row : [row], error: null };
            } else if (has('update')) {
              const patch = ops.find((o) => o.name === 'update')!.args[0] as Row;
              const hit = h.db[table].filter(matches);
              hit.forEach((r) => Object.assign(r, patch));
              out = { data: single ? (hit[0] ?? null) : hit, error: null };
            } else {
              let rows = h.db[table].filter(matches);
              const lim = ops.find((o) => o.name === 'limit')?.args[0] as number | undefined;
              if (lim) rows = rows.slice(0, lim);
              out = { data: single ? (rows[0] ?? null) : rows, error: null };
            }
            return Promise.resolve(out).then(res, rej);
          };
        }
        return (...args: unknown[]) => { ops.push({ name, args }); h.calls.push({ table, name, args }); return b; };
      },
    });
    return b;
  };
  return { supabase: { from } };
});

import {
  CANDIDATE_STATUSES,
  INTERRUPT_REASON,
  NEAR_THRESHOLD_MS,
  NO_RUNTIME_ACTIVITY_WINDOW_MS,
  SKIP_REASON,
  STALE_MISSION_AGE_MS,
  buildBeforeSnapshot,
  evaluateStaleMission,
  parseCleanupArgs,
  planSettlement,
  settleStaleMission,
  validateExecuteIds,
  type CleanupDeps,
  type MissionState,
} from '@/lib/swarm/staleCleanup';
import { makeLiveCleanupDeps } from '@/lib/swarm/staleCleanupDeps';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;

const mission = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-A', title: 'A stuck mission', status: 'executing', progress: 50,
  createdAt: ago(40 * H), updatedAt: ago(36 * H), metadata: {}, ...over,
});
const tk = (id: string, status: string, over: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, status, startedAt: null, updatedAt: ago(36 * H), errorMessage: null, result: null, ...over });
const real = (id: string) => tk(id, 'completed', { result: { output: 'ok' }, startedAt: ago(37 * H), completedAt: ago(36 * H) });

const evalOf = (m: Record<string, unknown>, tasks: any[], lastActivityAt: string | null = ago(36 * H)) =>
  evaluateStaleMission({ mission: mission(m), tasks, lastActivityAt, now: NOW });

describe('thresholds are the named constants', () => {
  it('6 hours stale, 6 hours without activity, 3 hours "near", and the five candidate statuses', () => {
    expect(STALE_MISSION_AGE_MS).toBe(6 * H);
    expect(NO_RUNTIME_ACTIVITY_WINDOW_MS).toBe(6 * H);
    expect(NEAR_THRESHOLD_MS).toBe(3 * H);
    expect(CANDIDATE_STATUSES).toEqual(['pending', 'planning', 'ready', 'executing', 'reviewing']);
  });
});

describe('the candidate rule', () => {
  it.each(CANDIDATE_STATUSES)('a %s mission older than 6h with no recent activity is a candidate', (status) => {
    const ev = evalOf({ status }, [tk('a', 'ready')]);
    expect(ev.verdict).toBe('candidate');
    expect(ev.reasons.join(' ')).toContain('older than 6h');
  });

  it('a mission updated less than 6 hours ago is NOT a candidate (the age condition)', () => {
    const young = evalOf({ updatedAt: ago(2 * H) }, [tk('a', 'ready', { updatedAt: ago(2 * H) })], ago(2 * H));
    expect(young.verdict).toBe('not_stale');
    expect(evalOf({ updatedAt: ago(5 * H + 59 * 60_000) }, [tk('a', 'ready', { updatedAt: ago(20 * H) })], null).verdict).toBe('not_stale');
    expect(evalOf({ updatedAt: ago(6 * H + 60_000) }, [tk('a', 'ready', { updatedAt: ago(20 * H) })], null).verdict).toBe('candidate');
  });

  it('flags missions at least 3h old (but under 6h) as close to the threshold', () => {
    expect(evalOf({ updatedAt: ago(4 * H) }, [], null).nearThreshold).toBe(true);
    expect(evalOf({ updatedAt: ago(1 * H) }, [], null).nearThreshold).toBe(false);
    expect(evalOf({ updatedAt: ago(30 * H) }, [], null).nearThreshold).toBe(false); // a candidate is not "near"
  });

  it('recent runtime activity (within 6h) keeps an old mission out; old or no activity does not', () => {
    const recent = evalOf({}, [tk('a', 'ready')], ago(2 * H));
    expect(recent.verdict).toBe('not_stale');
    expect(recent.reasons.join(' ')).toContain('runtime activity');
    expect(evalOf({}, [tk('a', 'ready')], ago(7 * H)).verdict).toBe('candidate');
    expect(evalOf({}, [tk('a', 'ready')], null).verdict).toBe('candidate');
  });

  it('a task changed within the threshold keeps the mission out', () => {
    expect(evalOf({}, [tk('a', 'running', { updatedAt: ago(1 * H) })]).verdict).toBe('not_stale');
  });

  it('NEVER a candidate: paused, any task awaiting approval, every terminal status, an unknown status', () => {
    expect(evalOf({ status: 'paused' }, [tk('a', 'ready')]).verdict).toBe('excluded');
    const awaiting = evalOf({}, [tk('a', 'ready'), tk('b', 'awaiting_approval')]);
    expect(awaiting.verdict).toBe('excluded');
    expect(awaiting.reasons.join(' ')).toContain('awaiting approval');
    for (const status of ['completed', 'partial', 'failed', 'cancelled', 'brand_new']) expect(evalOf({ status }, [tk('a', 'ready')]).verdict).toBe('excluded');
  });

  it('an unreadable updated_at or an unknown task status is never cleaned up', () => {
    expect(evalOf({ updatedAt: 'garbage' }, []).verdict).toBe('excluded');
    expect(evalOf({}, [tk('a', 'teleporting')]).verdict).toBe('excluded');
  });
});

describe('what the cleanup would settle a mission to (same outcome rules as a live run)', () => {
  it('only open tasks, nothing succeeded -> failed', () => {
    const p = planSettlement([tk('a', 'ready'), tk('b', 'waiting')]);
    expect(p).toMatchObject({ toSkip: ['a', 'b'], toFail: [], wouldStatus: 'failed' });
  });
  it('some tasks succeeded, the rest open -> partial', () => {
    const p = planSettlement([real('a'), tk('b', 'ready')]);
    expect(p).toMatchObject({ toSkip: ['b'], wouldStatus: 'partial' });
  });
  it('a stale running task is failed, not skipped', () => {
    const p = planSettlement([real('a'), tk('b', 'running'), tk('c', 'ready')]);
    expect(p).toMatchObject({ toSkip: ['c'], toFail: ['b'], wouldStatus: 'partial' });
    expect(planSettlement([tk('b', 'running')])).toMatchObject({ toFail: ['b'], wouldStatus: 'failed' });
  });
  it('already-resolved failures stay: failed + completed -> partial; all failed -> failed', () => {
    expect(planSettlement([real('a'), tk('b', 'failed', { errorMessage: 'x' })]).wouldStatus).toBe('partial');
    expect(planSettlement([tk('a', 'failed', { errorMessage: 'x' })]).wouldStatus).toBe('failed');
  });
  it('a mission with no tasks at all -> failed ("no tasks were ever created")', () => {
    expect(planSettlement([])).toMatchObject({ wouldStatus: 'failed', explanation: 'no tasks were ever created' });
  });
});

describe('arguments: default is a dry run; --execute needs explicit ids', () => {
  const noFile = () => { throw new Error('no file'); };
  const ID1 = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';

  it('no arguments = dry run', () => {
    expect(parseCleanupArgs([], noFile)).toEqual({ execute: false, ids: [], error: null });
    expect(parseCleanupArgs(['--dry-run'], noFile).execute).toBe(false);
  });

  it('--execute WITHOUT ids is refused', () => {
    const r = parseCleanupArgs(['--execute'], noFile);
    expect(r.error).toMatch(/requires an explicit list of mission ids/);
    expect(r.ids).toEqual([]);
    expect(parseCleanupArgs(['--execute', '--ids', ' , '], noFile).error).toMatch(/requires an explicit list/);
  });

  it('--execute with ids from --ids and/or --ids-file is accepted (deduplicated, lower-cased)', () => {
    expect(parseCleanupArgs(['--execute', '--ids', `${ID1},${ID2},${ID1.toUpperCase()}`], noFile)).toEqual({ execute: true, ids: [ID1, ID2], error: null });
    expect(parseCleanupArgs(['--execute', '--ids-file', 'x.txt'], () => `${ID1}\n${ID2}\n`)).toEqual({ execute: true, ids: [ID1, ID2], error: null });
  });

  it('refuses a malformed id, a missing value, an unknown flag and an unreadable file', () => {
    expect(parseCleanupArgs(['--execute', '--ids', 'not-an-id'], noFile).error).toMatch(/not a mission id/);
    expect(parseCleanupArgs(['--ids'], noFile).error).toMatch(/needs a value/);
    expect(parseCleanupArgs(['--yolo'], noFile).error).toMatch(/unknown argument/);
    expect(parseCleanupArgs(['--execute', '--ids-file', 'nope.txt'], noFile).error).toMatch(/cannot read/);
  });
});

describe('id validation: only current candidates are accepted', () => {
  it('refuses any requested id that is not a current candidate', () => {
    const r = validateExecuteIds(['a', 'b', 'c'], ['a', 'c']);
    expect(r.accepted).toEqual(['a', 'c']);
    expect(r.refused).toEqual([{ id: 'b', reason: 'not a current stale candidate' }]);
  });
  it('is case-insensitive and accepts nothing when there are no candidates', () => {
    expect(validateExecuteIds(['ABC'], ['abc']).accepted).toEqual(['ABC']);
    expect(validateExecuteIds(['a'], []).accepted).toEqual([]);
  });
});

describe('settleStaleMission with fake dependencies', () => {
  const makeDeps = (states: MissionState[], log: string[], opts: { claim?: boolean } = {}) => {
    let i = 0;
    const deps: CleanupDeps = {
      now: () => NOW,
      loadState: async () => states[Math.min(i++, states.length - 1)] ?? null,
      skipOpenTasks: async (_m, reason, meta) => { log.push(`skip:${reason}:${JSON.stringify(meta)}`); return [{ id: 's' }]; },
      failRunningTasks: async (_m, ids, reason, meta) => { log.push(`fail:${ids.join('+')}:${reason}:${JSON.stringify(meta)}`); return ids.map((id) => ({ id })); },
      claim: async (_m, status, progress) => { log.push(`claim:${status}:${progress}`); return opts.claim ?? true; },
      writeMetadata: async (_m, md) => { log.push(`meta:${JSON.stringify(md)}`); },
      recordMissionEvent: async (_m, type, _title, _detail, meta) => { log.push(`event:${type}:${JSON.stringify(meta)}`); },
    };
    return deps;
  };
  const before = (tasks: any[]): MissionState => ({ mission: mission(), tasks, lastActivityAt: ago(36 * H) });
  const afterTasks = (tasks: any[]): MissionState => ({ mission: mission(), tasks, lastActivityAt: ago(36 * H) });

  it('skips open tasks, fails running ones, claims the settled status, writes metadata and the event with {cleanup:true, reason:"abandoned"}', async () => {
    const log: string[] = [];
    const deps = makeDeps(
      [before([real('a'), tk('b', 'running'), tk('c', 'ready')]), afterTasks([real('a'), tk('b', 'failed', { errorMessage: INTERRUPT_REASON }), tk('c', 'skipped', { errorMessage: SKIP_REASON })])],
      log,
    );
    const report = await settleStaleMission('m', deps);
    expect(report).toMatchObject({ settled: true, status: 'partial', skipped: 1, interrupted: 1 });
    expect(log[0]).toBe(`skip:${SKIP_REASON}:{"cleanup":true,"reason":"abandoned"}`);
    expect(log[1]).toBe(`fail:b:${INTERRUPT_REASON}:{"cleanup":true,"reason":"abandoned"}`);
    expect(log[2]).toBe('claim:partial:100');
    expect(log[3]).toContain('"cleanup":{"at":"2026-11-07T12:00:00.000Z","reason":"abandoned","skippedTasks":1,"interruptedTasks":1}');
    expect(log[3]).toContain('"outcome"');
    expect(JSON.parse(log[4].slice('event:mission_partial:'.length))).toMatchObject({ cleanup: true, reason: 'abandoned' });
  });

  it('a mission with nothing succeeded settles as failed; one with no tasks settles as failed too', async () => {
    const log: string[] = [];
    const r1 = await settleStaleMission('m', makeDeps([before([tk('a', 'ready')]), afterTasks([tk('a', 'skipped', { errorMessage: SKIP_REASON })])], log));
    expect(r1).toMatchObject({ settled: true, status: 'failed' });
    expect(log.some((l) => l.startsWith('event:mission_failed:'))).toBe(true);
    const log2: string[] = [];
    const r2 = await settleStaleMission('m', makeDeps([before([])], log2));
    expect(r2).toMatchObject({ settled: true, status: 'failed' });
    expect(log2).toContain('claim:failed:0');
  });

  it('re-checks at execution time: a mission that is no longer a candidate is NOT touched (no write of any kind)', async () => {
    const log: string[] = [];
    const fresh: MissionState = { mission: mission({ updatedAt: ago(1 * H) }), tasks: [tk('a', 'ready', { updatedAt: ago(1 * H) })], lastActivityAt: ago(1 * H) };
    const r = await settleStaleMission('m', makeDeps([fresh], log));
    expect(r.settled).toBe(false);
    expect(r.note).toMatch(/no longer a stale candidate/);
    expect(log).toEqual([]);
  });

  it('is idempotent: once settled, a re-run finds a terminal mission and writes nothing', async () => {
    const log: string[] = [];
    const settled: MissionState = { mission: mission({ status: 'failed' }), tasks: [tk('a', 'skipped')], lastActivityAt: null };
    const r = await settleStaleMission('m', makeDeps([settled], log));
    expect(r.settled).toBe(false);
    expect(log).toEqual([]);
  });

  it('if another caller settled the mission first (claim lost), no metadata and no event are written', async () => {
    const log: string[] = [];
    const r = await settleStaleMission('m', makeDeps([before([tk('a', 'ready')]), afterTasks([tk('a', 'skipped')])], log, { claim: false }));
    expect(r.settled).toBe(false);
    expect(log.some((l) => l.startsWith('meta:') || l.startsWith('event:'))).toBe(false);
  });

  it('leaves the mission alone if the tasks are still not all resolved after the task writes', async () => {
    const log: string[] = [];
    const r = await settleStaleMission('m', makeDeps([before([tk('a', 'ready')]), afterTasks([tk('a', 'running', { updatedAt: ago(0) })])], log));
    expect(r.settled).toBe(false);
    expect(log.some((l) => l.startsWith('claim:'))).toBe(false);
  });

  it('the BEFORE snapshot lists every mission and task with status / progress / timestamps / error', () => {
    const snap = buildBeforeSnapshot([before([tk('a', 'running', { startedAt: ago(37 * H), errorMessage: 'x' })])], NOW) as any;
    expect(snap.missions[0]).toMatchObject({ id: mission().id, status: 'executing', progress: 50 });
    expect(snap.missions[0].tasks[0]).toEqual({ id: 'a', status: 'running', startedAt: ago(37 * H), completedAt: null, errorMessage: 'x' });
  });
});

describe('the REAL helpers the script uses (over a stateful fake database)', () => {
  const MID = '11111111-1111-4111-8111-111111111111';
  const taskRow = (id: string, status: string, extra: Row = {}) => ({
    id, mission_id: MID, objective_id: null, parent_task_id: null, assigned_manager: 'nova', assigned_worker: null, required_capability: 'x', title: `Task ${id}`,
    description: '', priority: 'medium', status, dependencies: [], retries: 0, max_retries: 3, execution_log: [], result: null, error_message: null,
    created_at: ago(40 * H), updated_at: ago(36 * H), started_at: null, completed_at: null, max_loop_steps: null, loop_state: null, ...extra,
  });

  beforeEach(() => {
    h.calls = [];
    h.nextId = 1;
    h.db.missions = [{
      id: MID, title: 'A stuck mission', objective: '', user_request: '', priority: 'medium', status: 'executing', progress: 50,
      estimated_complexity: 'moderate', estimated_tasks: 4, parent_mission_id: null, metadata: { keep: 'me' }, tenant_id: 'tenant-A', is_simulation: false,
      created_at: ago(40 * H), updated_at: ago(36 * H),
    }];
    h.db.mission_tasks = [
      taskRow('done', 'completed', { result: { output: 'ok' }, completed_at: ago(36 * H) }),
      taskRow('run', 'running', { started_at: ago(37 * H) }),
      taskRow('rdy', 'ready'),
      taskRow('wait', 'waiting'),
    ];
    h.db.runtime_activity = [{ id: 'ra1', mission_id: MID, created_at: ago(36 * H) }];
    h.db.mission_timeline = [];
  });

  const status = (id: string) => h.db.mission_tasks.find((r) => r.id === id)!.status;

  it('end to end: waiting/ready -> skipped, running -> failed, a completed task is never overwritten, the mission settles partial, nothing is deleted', async () => {
    const report = await settleStaleMission(MID, makeLiveCleanupDeps());
    expect(report).toMatchObject({ settled: true, status: 'partial', skipped: 2, interrupted: 1 });

    expect(status('done')).toBe('completed'); // untouched
    expect(status('rdy')).toBe('skipped');
    expect(status('wait')).toBe('skipped');
    expect(status('run')).toBe('failed');
    expect(h.db.mission_tasks.find((r) => r.id === 'rdy')!.error_message).toBe(SKIP_REASON);
    expect(h.db.mission_tasks.find((r) => r.id === 'run')!.error_message).toBe(INTERRUPT_REASON);

    const m = h.db.missions[0];
    expect(m.status).toBe('partial');
    expect(m.metadata.keep).toBe('me'); // merged, not replaced
    expect(m.metadata.outcome.status).toBe('partial');
    expect(m.metadata.cleanup).toMatchObject({ reason: 'abandoned', skippedTasks: 2, interruptedTasks: 1 });

    const events = h.db.mission_timeline;
    expect(events.filter((e) => e.event_type === 'task_skipped')).toHaveLength(2);
    expect(events.filter((e) => e.event_type === 'task_failed')).toHaveLength(1);
    expect(events.filter((e) => e.event_type === 'mission_partial')).toHaveLength(1);
    for (const e of events) expect(e.metadata).toMatchObject({ cleanup: true, reason: 'abandoned' });

    expect(h.calls.some((c) => c.name === 'delete')).toBe(false); // NO deletes, ever
  });

  it('the skip step only touches waiting/ready: .in("status", ["waiting","ready"]) is on the UPDATE', async () => {
    await settleStaleMission(MID, makeLiveCleanupDeps());
    const skipUpdate = h.calls.filter((c) => c.table === 'mission_tasks' && c.name === 'in' && JSON.stringify(c.args) === JSON.stringify(['status', ['waiting', 'ready']]));
    expect(skipUpdate).toHaveLength(1);
  });

  it('the running->failed step only touches status = running: .eq("status", "running") is on the UPDATE', async () => {
    await settleStaleMission(MID, makeLiveCleanupDeps());
    expect(h.calls.filter((c) => c.table === 'mission_tasks' && c.name === 'eq' && JSON.stringify(c.args) === JSON.stringify(['status', 'running']))).toHaveLength(1);
  });

  it('a running task that finished in the meantime is not overwritten (the conditional update matches nothing)', async () => {
    const live = makeLiveCleanupDeps();
    h.db.mission_tasks.find((r) => r.id === 'run')!.status = 'completed'; // it completed after the candidate check
    const tasks = await live.failRunningTasks(MID, ['run'], INTERRUPT_REASON, { cleanup: true });
    expect(tasks).toEqual([]);
    expect(status('run')).toBe('completed');
  });

  it('the terminal claim uses the positive non-terminal list: an already-settled mission is not overwritten', async () => {
    h.db.missions[0].status = 'completed';
    const live = makeLiveCleanupDeps();
    expect(await live.claim(MID, 'failed', 0)).toBe(false);
    expect(h.db.missions[0].status).toBe('completed');
  });

  it('re-running after a clean-up changes nothing more (idempotent)', async () => {
    await settleStaleMission(MID, makeLiveCleanupDeps());
    const snapshot = JSON.stringify([h.db.missions, h.db.mission_tasks, h.db.mission_timeline]);
    const second = await settleStaleMission(MID, makeLiveCleanupDeps());
    expect(second.settled).toBe(false);
    expect(JSON.stringify([h.db.missions, h.db.mission_tasks, h.db.mission_timeline])).toBe(snapshot);
  });
});

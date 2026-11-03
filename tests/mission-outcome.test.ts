// M7-13c-2b-1: the ONE mission outcome model (lib/swarm/missionOutcome.ts — pure, no I/O).
// Observed bug: 0 of 2 tasks succeeded, yet the chat said "completed with partial results".
// Product decisions under test: intended simulation counts as a success but is always tagged; a simulated result
// while the task ran in LIVE mode is an anomaly (NOT a success); failure reasons stay readable.

import { describe, it, expect } from 'vitest';
import {
  computeMissionOutcome, cleanReason, readSimulation, resolvedProgress, dbStatusOf, executionStateOf, outcomeMetadata,
  type OutcomeTaskInput,
} from '@/lib/swarm/missionOutcome';

let n = 0;
const task = (status: string, extra: Partial<OutcomeTaskInput> = {}): OutcomeTaskInput => ({ id: `t${++n}`, title: `Task ${n}`, status, ...extra });
const real = (extra: Partial<OutcomeTaskInput> = {}) => task('completed', { result: { output: 'A real answer.' }, ...extra });
const SIM_NOTE = 'Simulated execution of "web.search" — no real external action was taken.';
const sim = (mode: string | undefined = 'sandbox') => task('completed', { result: { output: SIM_NOTE, simulated: true, ...(mode ? { executionMode: mode } : {}) } });
const anomalous = () => sim('live');
const legacySim = () => task('completed', { result: { output: SIM_NOTE } }); // before the structured marker: only the text exists
const failed = (msg = 'Gemini request limit reached.') => task('failed', { errorMessage: msg });
const skipped = () => task('skipped', { errorMessage: 'Dependency failed.' });
const cancelled = () => task('cancelled');
const open = (status = 'ready') => task(status);

describe('computeMissionOutcome — the full input table', () => {
  const rows: Array<[string, () => OutcomeTaskInput[], Parameters<typeof computeMissionOutcome>[1], string, Partial<Record<string, number>>, boolean]> = [
    // label, tasks, opts, expected status, expected counts (subset), simulatedTag
    ['every task real & succeeded', () => [real(), real(), real()], {}, 'completed', { total: 3, succeeded: 3 }, false],
    ['one succeeded, one failed', () => [real(), failed()], {}, 'partial', { succeeded: 1, failed: 1 }, false],
    ['THE OBSERVED CASE: 0 of 2 succeeded (both failed)', () => [failed(), failed()], {}, 'failed', { total: 2, succeeded: 0, failed: 2 }, false],
    ['one succeeded, one skipped', () => [real(), skipped()], {}, 'partial', { succeeded: 1, skipped: 1 }, false],
    ['one succeeded, one cancelled (e.g. claim lost)', () => [real(), cancelled()], {}, 'partial', { succeeded: 1, cancelled: 1 }, false],
    ['two succeeded, one failed', () => [real(), real(), failed()], {}, 'partial', { succeeded: 2, failed: 1 }, false],
    ['one succeeded, two failed', () => [real(), failed(), failed()], {}, 'partial', { succeeded: 1, failed: 2 }, false],
    ['only failed + skipped', () => [failed(), skipped()], {}, 'failed', { failed: 1, skipped: 1 }, false],
    ['only skipped', () => [skipped(), skipped()], {}, 'failed', { skipped: 2 }, false],
    ['only cancelled (tasks cancelled, mission not)', () => [cancelled(), cancelled()], {}, 'failed', { cancelled: 2 }, false],
    // simulation: intended simulation is a supported way of working and counts as completed — always tagged
    ['ALL intended-simulated -> completed + Simulated tag', () => [sim(), sim('simulation')], {}, 'completed', { simulated: 2, succeeded: 0 }, true],
    ['real + intended-simulated -> completed + Simulated tag', () => [real(), sim()], {}, 'completed', { succeeded: 1, simulated: 1 }, true],
    ['1 simulated + 1 failed -> partial', () => [sim(), failed()], {}, 'partial', { simulated: 1, failed: 1 }, true],
    ['legacy row (text prefix, no executionMode) = intended-simulated', () => [legacySim(), legacySim()], {}, 'completed', { simulated: 2 }, true],
    ['legacy simulated + real -> completed, tagged', () => [legacySim(), real()], {}, 'completed', { simulated: 1, succeeded: 1 }, true],
    // anomaly: simulated while the task ran in LIVE mode is NOT a success
    ['simulated in LIVE only -> anomalous, mission failed', () => [anomalous()], {}, 'failed', { anomalous: 1, simulated: 0, succeeded: 0 }, false],
    ['real + simulated-in-LIVE -> partial', () => [real(), anomalous()], {}, 'partial', { succeeded: 1, anomalous: 1 }, false],
    ['intended-simulated + simulated-in-LIVE -> partial', () => [sim(), anomalous()], {}, 'partial', { simulated: 1, anomalous: 1 }, true],
    ['a completed row that merely STARTS with the note text but was in live mode and has no flag = real', () => [task('completed', { result: { output: SIM_NOTE, executionMode: 'live' } })], {}, 'completed', { succeeded: 1 }, false],
    // not finished
    ['one done, one ready -> in_progress', () => [real(), open('ready')], {}, 'in_progress', { succeeded: 1, open: 1 }, false],
    ['one done, one running -> in_progress', () => [real(), open('running')], {}, 'in_progress', { open: 1 }, false],
    ['one done, one waiting -> in_progress', () => [real(), open('waiting')], {}, 'in_progress', { open: 1 }, false],
    ['one done, one awaiting_approval -> in_progress', () => [real(), open('awaiting_approval')], {}, 'in_progress', { open: 1 }, false],
    ['a failed task does not end the mission while another is still open', () => [failed(), open()], {}, 'in_progress', { failed: 1, open: 1 }, false],
    ['an unknown task status is treated as not finished', () => [real(), open('some_future_status')], {}, 'in_progress', { open: 1 }, false],
    // force: abandoned mission — every open task is settled as skipped
    ['force: done + open -> partial', () => [real(), open('ready')], { force: true }, 'partial', { succeeded: 1, skipped: 1, open: 0 }, false],
    ['force: only open -> failed (nothing ran)', () => [open('ready'), open('waiting')], { force: true }, 'failed', { skipped: 2, open: 0 }, false],
    ['force: simulated + open -> partial, tagged', () => [sim(), open('ready')], { force: true }, 'partial', { simulated: 1, skipped: 1 }, true],
    // cancelled mission wins over everything
    ['mission cancelled, nothing done', () => [open(), open()], { missionCancelled: true }, 'cancelled', {}, false],
    ['mission cancelled even if every task succeeded', () => [real(), real()], { missionCancelled: true }, 'cancelled', { succeeded: 2 }, false],
    // no tasks
    ['no tasks while planning', () => [], { missionStatus: 'planning' }, 'in_progress', { total: 0 }, false],
    ['no tasks while pending', () => [], { missionStatus: 'pending' }, 'in_progress', { total: 0 }, false],
    ['no tasks once past planning', () => [], { missionStatus: 'executing' }, 'failed', { total: 0 }, false],
    ['no tasks, no status given', () => [], {}, 'failed', { total: 0 }, false],
  ];

  it.each(rows)('%s', (_label, make, opts, status, counts, tag) => {
    const o = computeMissionOutcome(make(), opts);
    expect(o.status).toBe(status);
    expect(o.simulatedTag).toBe(tag);
    for (const [k, v] of Object.entries(counts)) expect(o.counts[k as keyof typeof o.counts], `counts.${k}`).toBe(v);
  });
});

describe('progress = resolved / total (one helper)', () => {
  it('resolved counts every task that is not open', () => {
    expect(computeMissionOutcome([real(), failed(), open()]).progress).toBe(67);
    expect(computeMissionOutcome([real(), open(), open(), open()]).progress).toBe(25);
    expect(computeMissionOutcome([failed(), failed()]).progress).toBe(100);
    expect(computeMissionOutcome([]).progress).toBe(0);
  });
  it('force settles open tasks as skipped, so they count as resolved', () => {
    expect(computeMissionOutcome([real(), open()], { force: true }).progress).toBe(100);
  });
  it('resolvedProgress clamps and rounds, and tolerates a zero total', () => {
    expect(resolvedProgress(1, 3)).toBe(33);
    expect(resolvedProgress(5, 3)).toBe(100);
    expect(resolvedProgress(-2, 3)).toBe(0);
    expect(resolvedProgress(1, 0)).toBe(0);
  });
});

describe('mappings used by the writers', () => {
  const mk = (status: Parameters<typeof dbStatusOf>[0]['status']) => ({ status } as Parameters<typeof dbStatusOf>[0]);
  it('dbStatusOf: partial is stored as completed (no DB label yet); in_progress has no terminal status', () => {
    expect(dbStatusOf(mk('completed'))).toBe('completed');
    expect(dbStatusOf(mk('partial'))).toBe('completed');
    expect(dbStatusOf(mk('failed'))).toBe('failed');
    expect(dbStatusOf(mk('cancelled'))).toBe('cancelled');
    expect(dbStatusOf(mk('in_progress'))).toBeNull();
  });
  it('executionStateOf: runtime label derived from the outcome', () => {
    expect(executionStateOf(mk('in_progress'))).toBe('executing');
    expect(executionStateOf(mk('completed'))).toBe('completed');
    expect(executionStateOf(mk('partial'))).toBe('completed');
    expect(executionStateOf(mk('failed'))).toBe('failed');
    expect(executionStateOf(mk('cancelled'))).toBe('failed');
  });
  it('outcomeMetadata carries status, simulatedTag, counts and a computedAt stamp', () => {
    const o = computeMissionOutcome([real(), sim(), failed()]);
    const m = outcomeMetadata(o, '2026-11-03T00:00:00.000Z');
    expect(m).toEqual({ status: 'partial', simulatedTag: true, counts: o.counts, computedAt: '2026-11-03T00:00:00.000Z' });
  });
});

describe('readSimulation', () => {
  it('structured flag: intended unless the mode is live', () => {
    expect(readSimulation({ simulated: true, executionMode: 'sandbox' })).toMatchObject({ simulated: true, intended: true });
    expect(readSimulation({ simulated: true, executionMode: 'simulation' })).toMatchObject({ simulated: true, intended: true });
    expect(readSimulation({ simulated: true, executionMode: 'live' })).toMatchObject({ simulated: true, intended: false });
    expect(readSimulation({ simulated: true })).toMatchObject({ simulated: true, intended: true }); // mode unknown -> not live
  });
  it('legacy text prefix only counts when no executionMode was recorded', () => {
    expect(readSimulation({ output: SIM_NOTE })).toMatchObject({ simulated: true, intended: true });
    expect(readSimulation({ output: SIM_NOTE, executionMode: 'live' })).toMatchObject({ simulated: false });
  });
  it('nothing / null / a real result is not simulated', () => {
    expect(readSimulation(null).simulated).toBe(false);
    expect(readSimulation(undefined).simulated).toBe(false);
    expect(readSimulation({ output: 'Found three projects.', tools: ['web.search'] }).simulated).toBe(false);
  });
});

describe('failure reasons are readable — never raw JSON', () => {
  it('a provider JSON body is reduced to its message', () => {
    const raw = 'Gemini grounding request failed (429): {\n  "error": {\n    "code": 429,\n    "message": "You exceeded your current quota, please check your plan.",\n    "status": "RESOURCE_EXHAUSTED"\n  }\n}';
    const r = cleanReason(raw);
    expect(r).toContain('You exceeded your current quota');
    expect(r).toContain('Gemini grounding request failed (429)');
    expect(r).not.toMatch(/[{}"]/);
  });
  it('truncated JSON still loses its braces', () => {
    const r = cleanReason('Request failed: {\n  "error": {\n    "code": 503,\n    "message": "The model is overloaded. Plea');
    expect(r).toContain('The model is overloaded');
    expect(r).not.toMatch(/[{}"]/);
  });
  it('JSON with no message field is cut at the first brace', () => {
    expect(cleanReason('Tool failed {"a":1,"b":[2]}')).toBe('Tool failed');
    expect(cleanReason('{"a":1}')).toBe('The failure details are not available as readable text.');
  });
  it('plain text passes through, whitespace collapsed', () => {
    expect(cleanReason('  No matching   tool\ncould be planned.  ')).toBe('No matching tool could be planned.');
  });
  it('caps long text (280 characters, so the app own ~220-character sentences stay whole) and ends with an ellipsis', () => {
    const r = cleanReason('x'.repeat(500));
    expect(r.length).toBeLessThanOrEqual(280);
    expect(r.length).toBeGreaterThan(200);
    expect(r.endsWith('…')).toBe(true);
  });
  it('empty / null / undefined get an explicit "no reason" text', () => {
    for (const v of ['', '   ', null, undefined]) expect(cleanReason(v)).toBe('No reason was recorded.');
  });
  it('the reason in a failed task report uses it', () => {
    const o = computeMissionOutcome([failed('Boom {"error":{"message":"inner"}}')]);
    expect(o.parts.tasks[0].reason).toBe('Boom inner');
  });
});

describe('TaskReport — structured report data', () => {
  it('reads manager/worker, method (step names), tools, result and duration from the stored result', () => {
    const o = computeMissionOutcome([task('completed', {
      title: 'Research',
      assignedManager: 'nova', assignedWorker: null,
      startedAt: '2026-11-03T10:00:00.000Z', completedAt: '2026-11-03T10:00:12.500Z',
      retries: 1,
      result: {
        output: 'Three projects.', tools: ['web.search'],
        steps: [{ step: 'Tool Decision', status: 'completed', detail: '' }, { step: 'Tool Execution', status: 'completed', detail: '' }],
        agent: { manager: 'atlas', worker: 'atlas-researcher' },
      },
    })]);
    const r = o.parts.tasks[0];
    expect(r).toMatchObject({ title: 'Research', state: 'succeeded', manager: 'atlas', worker: 'atlas-researcher', tools: ['web.search'], result: 'Three projects.', durationMs: 12500, simulated: false, retries: 1, reason: null });
    expect(r.method).toEqual(['Tool Decision', 'Tool Execution']);
  });
  it('falls back to the task row for agents, and tolerates a result with no output (failed task / old row)', () => {
    const o = computeMissionOutcome([task('failed', { assignedManager: 'nova', assignedWorker: 'nova-qa', errorMessage: 'No tools.', result: { failure: { kind: 'no_match', deterministic: true, attempts: 1 }, agent: {} } }), task('completed', { result: null })]);
    expect(o.parts.tasks[0]).toMatchObject({ manager: 'nova', worker: 'nova-qa', result: '', state: 'failed', reason: 'No tools.' });
    expect(o.parts.tasks[1]).toMatchObject({ state: 'succeeded', result: '', tools: [], method: [] });
  });
  it('groups: failed = failed + anomalous; remaining = open + skipped + cancelled', () => {
    const o = computeMissionOutcome([real(), failed(), anomalous(), open(), skipped(), cancelled()]);
    expect(o.parts.failed.map((t) => t.state).sort()).toEqual(['anomalous', 'failed']);
    expect(o.parts.remaining.map((t) => t.state).sort()).toEqual(['cancelled', 'open', 'skipped']);
    expect(o.parts.tasks).toHaveLength(6);
  });
  it('an anomalous task explains why it is not counted', () => {
    expect(computeMissionOutcome([anomalous()]).parts.tasks[0].reason).toMatch(/Live mode.*simulation/);
  });
  it('open tasks say why they are open', () => {
    const o = computeMissionOutcome([open('awaiting_approval'), open('running'), open('ready')]);
    expect(o.parts.tasks.map((t) => t.reason)).toEqual(['Waiting for a human approval.', 'Still running.', 'Not started yet.']);
  });
});

// M7-13c-2b-1: the mission report text is written from the SAME outcome object that decided the status.
//   BRIEF (default, the chat reply): results only — NO agents / methods / tools; failure reasons and Simulated tags stay.
//   FULL: per task — who executed it, method, tools, result, duration, Simulated tag, reason if failed.
// Observed bug under test: 2 failed tasks must never produce "completed with partial results".

import { describe, it, expect } from 'vitest';
import { computeMissionOutcome, type OutcomeTaskInput } from '@/lib/swarm/missionOutcome';
import { buildMissionResponse, SIMULATED_SENTENCE } from '@/lib/swarm/missionMessages';

const NOTE = 'Simulated execution of "gmail.send" — no real external action was taken.';
const mk = (id: string, status: string, extra: Partial<OutcomeTaskInput> = {}): OutcomeTaskInput => ({ id, title: `Task ${id}`, status, ...extra });
const done = (id: string, output: string, extra: Partial<OutcomeTaskInput> = {}) => mk(id, 'completed', {
  assignedManager: 'atlas', assignedWorker: 'atlas-researcher',
  startedAt: '2026-11-03T10:00:00.000Z', completedAt: '2026-11-03T10:00:08.000Z',
  result: { output, tools: ['web.search'], steps: [{ step: 'Tool Decision', status: 'completed', detail: '' }, { step: 'Tool Execution', status: 'completed', detail: '' }], agent: { manager: 'atlas', worker: 'atlas-researcher' } },
  ...extra,
});
const sim = (id: string) => mk(id, 'completed', {
  assignedManager: 'echo',
  result: { output: NOTE, simulated: true, executionMode: 'sandbox', tools: ['gmail.send'], steps: [{ step: 'Tool Execution', status: 'completed', detail: '' }], agent: { manager: 'echo', worker: null } },
});
const bad = (id: string, msg: string) => mk(id, 'failed', { errorMessage: msg, assignedManager: 'nova' });

const QUOTA = "Gemini's request limit for models gemini-flash-lite-latest and gemini-3.6-flash was reached on this workspace's API key. Try again later, pin another model in Settings → AI Providers, or enable billing in Google AI Studio.";
const RAW_429 = 'Gemini grounding request failed (429): {\n  "error": {\n    "code": 429,\n    "message": "You exceeded your current quota, please check your plan and billing details.",\n    "status": "RESOURCE_EXHAUSTED"\n  }\n}';

describe('the observed case: 0 of 2 tasks succeeded', () => {
  const outcome = computeMissionOutcome([bad('1', QUOTA), bad('2', QUOTA)]);
  const msg = buildMissionResponse(outcome, { title: 'search for an open source code for a Jarvis' });

  it('says the mission FAILED with the real numbers — never "partial results", never "completed"', () => {
    expect(msg).toContain('Mission failed: 0 of 2 tasks succeeded.');
    expect(msg).not.toMatch(/partial/i);
    expect(msg).not.toMatch(/No tasks completed successfully/);
    expect(msg).not.toMatch(/mission completed/i);
  });
  it('has one line per failed task with its readable reason', () => {
    expect(msg).toContain('- Task 1: ' + QUOTA);
    expect(msg).toContain('- Task 2: ' + QUOTA);
  });
  it('has the mission heading', () => {
    expect(msg.startsWith('## Mission: search for an open source code for a Jarvis')).toBe(true);
  });
  it('a raw provider JSON reason is shown as plain text — no braces, quotes or JSON', () => {
    const m = buildMissionResponse(computeMissionOutcome([bad('1', RAW_429), bad('2', RAW_429)]));
    expect(m).toContain('You exceeded your current quota');
    expect(m).not.toMatch(/[{}]/);
    expect(m).not.toContain('"error"');
  });
});

describe('"partial" is said only for a partial outcome', () => {
  it('a partial outcome says what was done, what failed and why, and what remains and why', () => {
    const o = computeMissionOutcome([done('1', 'Found three projects: A, B, C.'), bad('2', 'No matching tool could be planned or matched for this request.'), mk('3', 'cancelled')]);
    const m = buildMissionResponse(o);
    expect(o.status).toBe('partial');
    expect(m).toContain('Mission partially done: 1 of 3 tasks succeeded.');
    expect(m).toContain('Found three projects: A, B, C.'); // the final real result, in full
    expect(m).not.toContain('### Also done'); // it is the only success: nothing else to list
    expect(m).toContain('### What failed and why');
    expect(m).toContain('- Task 2: No matching tool could be planned or matched for this request.');
    expect(m).toContain('### What remains and why');
    expect(m).toContain('- Task 3: Cancelled before it ran.');
  });
  it.each([
    ['completed', () => [done('1', 'All good.')]],
    ['failed', () => [bad('1', 'x')]],
    ['in progress', () => [done('1', 'ok'), mk('2', 'ready')]],
    ['cancelled mission', () => [done('1', 'ok')]],
  ])('%s never contains the word "partial"', (_l, make) => {
    const o = computeMissionOutcome(make(), _l === 'cancelled mission' ? { missionCancelled: true } : {});
    expect(buildMissionResponse(o)).not.toMatch(/partial/i);
    expect(buildMissionResponse(o, { detail: 'full' })).not.toMatch(/partial/i);
  });
  it('completed shows the final real result; in-progress names what is still open', () => {
    expect(buildMissionResponse(computeMissionOutcome([done('1', 'First.'), done('2', 'The final synthesized answer.')])))
      .toContain('The final synthesized answer.');
    const m = buildMissionResponse(computeMissionOutcome([done('1', 'ok'), mk('2', 'awaiting_approval')]));
    expect(m).toContain('Mission in progress: 1 of 2 tasks finished.');
    expect(m).toContain('- Task 2: Waiting for a human approval.');
  });
  it('a mission with no tasks that failed says so', () => {
    expect(buildMissionResponse(computeMissionOutcome([], { missionStatus: 'executing' }))).toContain('Mission failed: no tasks were created.');
  });
});

describe('BRIEF never truncates the final result — also when the mission is only partly done', () => {
  const LONG = 'START ' + 'This is a long final answer sentence. '.repeat(20) + 'THE-VERY-END';

  it('PARTIAL with a final result longer than 200 characters prints it COMPLETELY, then title-only lines, then reasons', () => {
    expect(LONG.length).toBeGreaterThan(600);
    const o = computeMissionOutcome([done('1', 'Short earlier result that must not be repeated.'), done('2', LONG), bad('3', 'Gemini limit reached.')]);
    const m = buildMissionResponse(o);
    expect(o.status).toBe('partial');
    expect(m).toContain(LONG);
    expect(m).not.toContain('…');
    // order: status line, final result, other succeeded tasks (title only), failures
    const iStatus = m.indexOf('Mission partially done');
    const iFinal = m.indexOf('START ');
    const iAlso = m.indexOf('### Also done');
    const iFailed = m.indexOf('### What failed and why');
    expect(iStatus).toBeGreaterThanOrEqual(0);
    expect(iFinal).toBeGreaterThan(iStatus);
    expect(iAlso).toBeGreaterThan(iFinal);
    expect(iFailed).toBeGreaterThan(iAlso);
    expect(m).toContain('- Task 1\n'); // title only ...
    expect(m).not.toContain('Short earlier result'); // ... its result text is not repeated
    expect(m).toContain('- Task 3: Gemini limit reached.');
  });

  it('PARTIAL keeps BRIEF free of agent / worker / tool / step / duration text', () => {
    const m = buildMissionResponse(computeMissionOutcome([done('1', 'First.'), done('2', LONG), bad('3', 'x')]));
    for (const hidden of ['atlas', 'atlas-researcher', 'web.search', 'Tool Decision', 'Tool Execution', 'Executed by', 'Method', 'Tools:', 'Duration']) {
      expect(m, `BRIEF must not contain "${hidden}"`).not.toContain(hidden);
    }
  });

  it('PARTIAL where the only success is simulated: no result block, the simulated task is listed with the Simulated sentence', () => {
    const m = buildMissionResponse(computeMissionOutcome([sim('1'), bad('2', 'Tool is not implemented yet.')]));
    expect(m).toContain(`- Task 1 — ${SIMULATED_SENTENCE}`);
    expect(m).not.toContain('### Also done');
  });

  it('PARTIAL: a real result followed by a simulated success lists the simulated task with the Simulated sentence', () => {
    const m = buildMissionResponse(computeMissionOutcome([done('1', LONG), sim('2'), bad('3', 'x')]));
    expect(m).toContain(LONG);
    expect(m).toContain('### Also done');
    expect(m).toContain(`- Task 2 — ${SIMULATED_SENTENCE}`);
  });

  it('PARTIAL where the LAST succeeded task has an empty result: the last NON-EMPTY real result is printed in full, the empty one is listed by title', () => {
    const empty = mk('2', 'completed', { assignedManager: 'atlas', result: { output: '', tools: ['web.search'], agent: { manager: 'atlas', worker: null } } });
    const m = buildMissionResponse(computeMissionOutcome([done('1', LONG), empty, bad('3', 'x')]));
    expect(m).toContain(LONG);
    expect(m).toContain('### Also done');
    expect(m).toContain('- Task 2\n');
    expect(m).not.toContain('no text result recorded');
  });

  it('IN PROGRESS shows the same structure: final result in full, other done tasks by title, what remains and why', () => {
    const o = computeMissionOutcome([done('1', 'Earlier.'), done('2', LONG), mk('3', 'awaiting_approval')]);
    const m = buildMissionResponse(o);
    expect(o.status).toBe('in_progress');
    expect(m).toContain('Mission in progress: 2 of 3 tasks finished.');
    expect(m).toContain(LONG);
    expect(m).not.toContain('…');
    expect(m).toContain('### Also done');
    expect(m).toContain('- Task 1\n');
    expect(m).not.toContain('Earlier.');
    expect(m).toContain('### What remains and why');
    expect(m).toContain('- Task 3: Waiting for a human approval.');
  });

  it('IN PROGRESS with only a simulated success uses the "Done so far" list', () => {
    const m = buildMissionResponse(computeMissionOutcome([sim('1'), mk('2', 'ready')]));
    expect(m).toContain('### Done so far');
    expect(m).toContain(`- Task 1 — ${SIMULATED_SENTENCE}`);
  });

  it('COMPLETED still prints the final result in full (unchanged rule)', () => {
    const m = buildMissionResponse(computeMissionOutcome([done('1', 'Earlier.'), done('2', LONG)]));
    expect(m).toContain(LONG);
  });
});

describe('Simulated is always tagged and never described as real work', () => {
  it('all-simulated mission: completed, says Simulated, shows no real result', () => {
    const m = buildMissionResponse(computeMissionOutcome([sim('1'), sim('2')]));
    expect(m).toContain('Mission completed: 2 of 2 tasks succeeded.');
    expect(m).toContain(SIMULATED_SENTENCE);
    expect(m).not.toContain('Simulated execution of'); // the raw note text is not repeated as if it were a result
  });
  it('real + simulated: states how many were simulated', () => {
    const m = buildMissionResponse(computeMissionOutcome([done('1', 'Real answer.'), sim('2')]));
    expect(m).toContain('1 of them simulated — no real action was taken for those.');
    expect(m).toContain('Real answer.');
    expect(m).toContain(`- Task 2 — ${SIMULATED_SENTENCE}`);
  });
  it('partial where the ONLY success is simulated: the Simulated sentence is the done-list, no result is invented', () => {
    const m = buildMissionResponse(computeMissionOutcome([sim('1'), bad('2', 'Tool is not implemented yet.')]));
    expect(m).toContain('Mission partially done: 1 of 2 tasks succeeded.');
    expect(m).toContain('### What was done');
    expect(m).toContain(`- Task 1 — ${SIMULATED_SENTENCE}`);
    expect(m).not.toContain('Simulated execution of');
    expect(m).toContain('- Task 2: Tool is not implemented yet.');
  });
  it('a simulated-in-LIVE task is shown as not counted, with the reason', () => {
    const live = mk('1', 'completed', { result: { output: NOTE, simulated: true, executionMode: 'live' } });
    const m = buildMissionResponse(computeMissionOutcome([live]));
    expect(m).toContain('Mission failed: 0 of 1 tasks succeeded.');
    expect(m).toMatch(/Task 1: Not counted: this task ran in Live mode/);
  });
});

describe('BRIEF has NO who / how / with-what; FULL has all of it', () => {
  const o = computeMissionOutcome([
    done('1', 'Three projects found: Open-JARVIS, Jarvis-AI, MyJarvis.'),
    sim('2'),
    bad('3', 'Gemini rejected this workspace\'s API key (HTTP 403) — check or replace it in Settings → AI Providers.'),
  ]);

  it('BRIEF (the default) omits agent names, workers, tool ids, steps, durations — but keeps results, reasons and Simulated', () => {
    for (const m of [buildMissionResponse(o), buildMissionResponse(o, { detail: 'brief' })]) {
      for (const hidden of ['atlas', 'atlas-researcher', 'echo', 'nova', 'web.search', 'gmail.send', 'Tool Decision', 'Tool Execution', 'Executed by', 'Method', 'Tools:', 'Duration', '8.0 s']) {
        expect(m, `BRIEF must not contain "${hidden}"`).not.toContain(hidden);
      }
      expect(m).toContain('Three projects found: Open-JARVIS, Jarvis-AI, MyJarvis.');
      expect(m).toContain(SIMULATED_SENTENCE);
      expect(m).toContain('Gemini rejected this workspace\'s API key (HTTP 403)');
    }
  });

  it('FULL has per task: title, who (manager → worker), method, tools, result, duration, Simulated tag, failure reason', () => {
    const m = buildMissionResponse(o, { detail: 'full' });
    expect(m).toContain('### 1. Task 1 — Completed');
    expect(m).toContain('- Executed by: atlas → atlas-researcher');
    expect(m).toContain('- Method: Tool Decision → Tool Execution');
    expect(m).toContain('- Tools: web.search');
    expect(m).toContain('- Duration: 8.0 s');
    expect(m).toContain('- Result: Three projects found: Open-JARVIS, Jarvis-AI, MyJarvis.');
    expect(m).toContain('### 2. Task 2 — Completed (Simulated)');
    expect(m).toContain('- Executed by: echo');
    expect(m).toContain('- Tools: gmail.send');
    expect(m).toContain(`- Result: ${SIMULATED_SENTENCE}`);
    expect(m).toContain('### 3. Task 3 — Failed');
    expect(m).toContain('- Executed by: nova');
    expect(m).toContain('- Method: not recorded');
    expect(m).toContain('- Tools: none');
    expect(m).toContain('- Reason: Gemini rejected this workspace\'s API key (HTTP 403)');
  });

  it('FULL also shows retries when there were any, and an unrecorded duration plainly', () => {
    const m = buildMissionResponse(computeMissionOutcome([bad('1', 'x')].map((t) => ({ ...t, retries: 3 }))), { detail: 'full' });
    expect(m).toContain('- Retries: 3');
    expect(m).toContain('- Duration: not recorded');
  });

  it('neither renderer ever prints braces or JSON for a failure reason', () => {
    const w = computeMissionOutcome([bad('1', RAW_429), bad('2', 'Provider said {"error":{"message":"boom"}}')]);
    for (const detail of ['brief', 'full'] as const) {
      const m = buildMissionResponse(w, { detail });
      expect(m).not.toMatch(/[{}]/);
      expect(m).toContain('You exceeded your current quota');
      expect(m).toContain('boom');
    }
  });
});

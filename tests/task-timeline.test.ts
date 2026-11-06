// M7-13c-2b-3 (Part B): the per-task Timeline row model. Pure — no database.

import { describe, it, expect } from 'vitest';
import { buildTaskTimeline, formatTaskDuration, tidyText } from '@/lib/swarm/taskTimeline';

const T0 = '2026-11-07T10:00:00.000Z';
const at = (s: number) => new Date(new Date(T0).getTime() + s * 1000).toISOString();

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', status: 'completed', assignedManager: 'nova', assignedWorker: 'scout', retries: 0, maxRetries: 3,
  startedAt: at(0), completedAt: at(42), errorMessage: null as string | null, result: { output: 'Found three trends.', tools: ['web.search'] } as Record<string, unknown> | null,
  ...over,
});
let n = 0;
const ev = (eventType: string, s: number, over: Record<string, unknown> = {}) => ({
  id: `e${++n}`, eventType, entityId: 't1', title: `${eventType} title`, detail: '', metadata: {}, createdAt: at(s), ...over,
});

describe('buildTaskTimeline', () => {
  it('a completed task: start / end / duration, agent, result summary, ordered rows', () => {
    const tl = buildTaskTimeline(task(), [
      ev('task_assigned', 0, { detail: 'Research — best fit' }),
      ev('task_started', 1),
      ev('provider_selected', 2, { title: 'Provider: groq', detail: 'Model: llama — ok' }),
      ev('tool_selected', 3, { title: 'Tool selected: web.search', metadata: { toolIds: ['web.search'] } }),
      ev('execution_finished', 42, { detail: 'Completed in 41000ms after 0 retry(ies)' }),
      ev('task_completed', 42),
    ]);
    expect(tl.summary).toMatchObject({ status: 'completed', durationMs: 42_000, manager: 'nova', worker: 'scout', retries: 0, simulated: null, reason: null, resultSummary: 'Found three trends.' });
    expect(tl.summary.providers).toEqual(['groq']);
    expect(tl.summary.tools).toEqual(['web.search']);
    expect(tl.rows.map((r) => r.kind)).toEqual(['task_assigned', 'task_started', 'provider_selected', 'tool_selected', 'execution_finished', 'task_completed']);
    expect(tl.rows[0].label).toBe('Assigned');
  });

  it('a failed task with retries: every retry is a row, the retry count and the failure reason survive (provider JSON reduced to its message)', () => {
    const raw = 'Gemini request failed: {"error":{"code":429,"message":"Quota exceeded for this key."}}';
    const tl = buildTaskTimeline(task({ status: 'failed', retries: 2, maxRetries: 3, errorMessage: raw, result: { failure: { kind: 'provider', deterministic: false, attempts: 3 } } }), [
      ev('task_started', 0),
      ev('execution_retried', 5, { detail: `Attempt 2/4 after: ${raw}` }),
      ev('execution_retried', 12, { detail: 'Attempt 3/4 after: Quota exceeded for this key.' }),
      ev('execution_failed', 40, { detail: raw }),
      ev('task_failed', 40, { detail: raw }),
    ]);
    expect(tl.rows.filter((r) => r.kind === 'execution_retried')).toHaveLength(2);
    expect(tl.rows.filter((r) => r.kind === 'execution_retried').every((r) => r.tone === 'warn')).toBe(true);
    expect(tl.summary.retries).toBe(2);
    expect(tl.summary.maxRetries).toBe(3);
    expect(tl.summary.failureKind).toBe('provider');
    expect(tl.summary.reason).toContain('Quota exceeded for this key.');
    // never raw JSON anywhere
    for (const r of tl.rows) expect(r.detail).not.toMatch(/[{}]|"error"/);
    expect(tl.summary.reason).not.toMatch(/[{}]|"error"/);
  });

  it('the retry count also comes from the events when the task row lags behind', () => {
    const tl = buildTaskTimeline(task({ status: 'running', retries: 0, completedAt: null }), [ev('execution_retried', 3), ev('execution_retried', 9)]);
    expect(tl.summary.retries).toBe(2);
  });

  it('a skipped task: muted, with the skip reason, no duration', () => {
    const tl = buildTaskTimeline(task({ status: 'skipped', startedAt: null, completedAt: at(0), errorMessage: 'Never executed — the mission was abandoned and cleaned up', result: null }), [
      ev('task_skipped', 0, { detail: 'Never executed — the mission was abandoned and cleaned up' }),
    ]);
    expect(tl.summary.status).toBe('skipped');
    expect(tl.summary.durationMs).toBeNull();
    expect(tl.summary.reason).toBe('Never executed — the mission was abandoned and cleaned up');
    expect(tl.rows).toHaveLength(1);
    expect(tl.rows[0]).toMatchObject({ kind: 'task_skipped', label: 'Skipped', tone: 'muted' });
  });

  it('a simulated task carries the Simulated tag; a simulated result in Live mode is flagged as an anomaly', () => {
    const sim = buildTaskTimeline(task({ result: { output: 'Simulated execution of "x"', simulated: true, executionMode: 'demo' } }), []);
    expect(sim.summary.simulated).toBe('simulated');
    expect(sim.summary.executionMode).toBe('demo');
    const anomaly = buildTaskTimeline(task({ result: { output: 'x', simulated: true, executionMode: 'live' } }), []);
    expect(anomaly.summary.simulated).toBe('anomalous');
    expect(buildTaskTimeline(task(), []).summary.simulated).toBeNull();
  });

  it('a task with no events yet still has its summary; rows come only from the task row itself', () => {
    const waiting = buildTaskTimeline(task({ status: 'waiting', startedAt: null, completedAt: null, result: null }), []);
    expect(waiting.rows).toEqual([]);
    expect(waiting.summary).toMatchObject({ status: 'waiting', startedAt: null, endedAt: null, durationMs: null });
    const running = buildTaskTimeline(task({ status: 'running', completedAt: null }), []);
    expect(running.rows.map((r) => r.kind)).toEqual(['task_started']); // synthetic, from started_at
    expect(running.summary.endedAt).toBeNull();
  });

  it('events out of order (and of other tasks) are sorted by time and filtered by task; equal times keep their input order', () => {
    const tl = buildTaskTimeline(task(), [
      ev('task_completed', 30),
      ev('task_started', 1),
      ev('task_started', 0, { entityId: 'other-task' }),
      ev('tool_selected', 10),
      ev('provider_selected', 10, { title: 'Provider: groq' }),
    ]);
    expect(tl.rows.map((r) => r.kind)).toEqual(['task_started', 'tool_selected', 'provider_selected', 'task_completed']);
  });

  it('an unknown event type is shown generically and never crashes (also with a missing time or weird detail)', () => {
    const tl = buildTaskTimeline(task(), [
      ev('brand_new_event_v9', 5, { title: 'Something new happened', detail: '' }),
      ev('another_one', 6, { detail: '{"raw":"json"}' }),
      ev('weird', 7, { createdAt: 'not-a-date', detail: undefined as unknown as string, title: undefined as unknown as string }),
    ]);
    const generic = tl.rows.find((r) => r.kind === 'brand_new_event_v9')!;
    expect(generic.label).toBe('Brand new event v9');
    expect(generic.detail).toBe('Something new happened');
    expect(generic.tone).toBe('neutral');
    expect(tl.rows.find((r) => r.kind === 'another_one')!.detail).toBe('Structured data recorded.'); // never raw JSON
    expect(tl.rows[tl.rows.length - 1].kind).toBe('weird'); // no usable time -> last
    expect(tl.rows.find((r) => r.kind === 'weird')!.at).toBeNull();
  });

  it('provider hops: more than one distinct provider is reported in order', () => {
    const tl = buildTaskTimeline(task(), [
      ev('provider_selected', 1, { title: 'Provider: groq' }),
      ev('provider_selected', 9, { title: 'Provider: gemini' }),
      ev('provider_selected', 15, { title: 'Provider: groq' }),
    ]);
    expect(tl.summary.providers).toEqual(['groq', 'gemini']);
  });

  it('runtime activity rows of the task are merged in time order; those of other tasks are ignored; a repeated row is dropped', () => {
    const activity = [
      { id: 'r1', eventType: 'executing', title: 'Executing task', detail: '', taskId: 't1', status: 'running', createdAt: at(2) },
      { id: 'r2', eventType: 'completed', title: 'Task done', detail: '', taskId: 'other', status: 'completed', createdAt: at(3) },
      { id: 'r3', eventType: 'failed', title: 'Task failed', detail: '{"error":{"message":"Boom happened"}}', taskId: 't1', status: 'failed', createdAt: at(4) },
      { id: 'r4', eventType: 'failed', title: 'Task failed', detail: '{"error":{"message":"Boom happened"}}', taskId: 't1', status: 'failed', createdAt: at(4) },
    ];
    const tl = buildTaskTimeline(task({ status: 'failed', errorMessage: 'Boom happened' }), [ev('task_started', 0)], activity);
    const runtime = tl.rows.filter((r) => r.source === 'runtime');
    expect(runtime.map((r) => r.id)).toEqual(['rt:r1', 'rt:r3']);
    expect(runtime[1].detail).toBe('Boom happened');
    expect(runtime[1].tone).toBe('error');
  });

  it('the task row stands in for a missing end event (late or lost timeline write)', () => {
    const tl = buildTaskTimeline(task({ status: 'failed', errorMessage: 'It broke.', completedAt: at(9) }), [ev('task_started', 0)]);
    expect(tl.rows.map((r) => r.kind)).toEqual(['task_started', 'task_failed']);
    expect(tl.rows[1]).toMatchObject({ source: 'task', label: 'Failed', detail: 'It broke.' });
  });
});

describe('helpers', () => {
  it('tidyText never returns raw JSON and caps long text', () => {
    expect(tidyText('{"a":1}')).toBe('Structured data recorded.');
    expect(tidyText('[1,2]')).toBe('Structured data recorded.');
    expect(tidyText('x'.repeat(500), 50).length).toBe(50);
    expect(tidyText(undefined)).toBe('');
  });

  it('formatTaskDuration', () => {
    expect(formatTaskDuration(null)).toBe('—');
    expect(formatTaskDuration(340)).toBe('340ms');
    expect(formatTaskDuration(12_000)).toBe('12s');
    expect(formatTaskDuration(65_000)).toBe('1m 05s');
  });
});

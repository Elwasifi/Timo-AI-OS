// M7-13c-2b-1c: the deadline helpers behind the mission task path (lib/swarm/taskDeadlines.ts).

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  DeadlineError,
  withDeadline,
  bestEffort,
  boundedStatusWrite,
  createTaskRunGuard,
  taskHardDeadlineMs,
  SIDE_EFFECT_WRITE_TIMEOUT_MS,
  STATUS_WRITE_TIMEOUT_MS,
} from '@/lib/swarm/taskDeadlines';

const never = () => new Promise<never>(() => {});

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withDeadline', () => {
  it('resolves with the value and leaves no timer behind', async () => {
    await expect(withDeadline('step', 1000, () => Promise.resolve(42))).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a DeadlineError that names the step and the seconds', async () => {
    const p = withDeadline('Tool step', 60_000, never);
    const assertion = expect(p).rejects.toMatchObject({ name: 'DeadlineError', message: 'Tool step timed out after 60 s', step: 'Tool step', ms: 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('passes the work\'s own rejection through unchanged', async () => {
    await expect(withDeadline('step', 1000, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a synchronous throw into a rejection', async () => {
    await expect(withDeadline('step', 1000, () => { throw new Error('sync boom'); })).rejects.toThrow('sync boom');
  });
});

describe('bestEffort — non-fatal side-effect writes', () => {
  it('returns the value on success', async () => {
    await expect(bestEffort('timeline event x', {}, async () => 'ok')).resolves.toBe('ok');
  });

  it('never throws: a write that never settles resolves to undefined after 15 s, with a log line naming step, task and mission', async () => {
    const p = bestEffort('timeline event tool_decision_outcome', { taskId: 't-1', missionId: 'm-1' }, never);
    await vi.advanceTimersByTimeAsync(SIDE_EFFECT_WRITE_TIMEOUT_MS);
    await expect(p).resolves.toBeUndefined();
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('[swarm] timeline event tool_decision_outcome timed out');
    expect(line).toContain('task=t-1');
    expect(line).toContain('mission=m-1');
    expect(line).toMatch(/\d+ms elapsed/);
  });

  it('never throws: a write that rejects is logged as failed', async () => {
    await expect(bestEffort('execution log append', { taskId: 't-1' }, () => Promise.reject(new Error('db down')))).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0][0])).toContain('[swarm] execution log append failed: db down');
  });
});

describe('boundedStatusWrite — status-changing writes', () => {
  it('a first attempt that times out is retried once, and the second result is returned', async () => {
    const fn = vi.fn().mockImplementationOnce(never).mockResolvedValueOnce('applied');
    const p = boundedStatusWrite('task completed', { taskId: 't-1' }, fn);
    await vi.advanceTimersByTimeAsync(STATUS_WRITE_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ ok: true, value: 'applied' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('two failed attempts: never throws, logs an error carrying the task id, returns ok:false', async () => {
    const p = boundedStatusWrite('task completed', { taskId: 't-9', missionId: 'm-9' }, never);
    await vi.advanceTimersByTimeAsync(STATUS_WRITE_TIMEOUT_MS * 2);
    await expect(p).resolves.toEqual({ ok: false });
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain('[swarm] task completed could not be written');
    expect(line).toContain('task=t-9');
    expect(line).toContain('mission=m-9');
  });

  it('a write that settles with null (a conditional UPDATE that matched nothing) is NOT retried', async () => {
    const fn = vi.fn().mockResolvedValue(null);
    await expect(boundedStatusWrite('task completed', {}, fn)).resolves.toEqual({ ok: true, value: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('hard deadline and run guard', () => {
  it('is 2x task_timeout_ms, defaulting to 2 x 90 s', () => {
    expect(taskHardDeadlineMs(90_000)).toBe(180_000);
    expect(taskHardDeadlineMs(30_000)).toBe(60_000);
    expect(taskHardDeadlineMs(undefined)).toBe(180_000);
    expect(taskHardDeadlineMs(0)).toBe(180_000);
  });

  it('a new guard is not superseded and starts with no attempts', () => {
    expect(createTaskRunGuard()).toMatchObject({ superseded: false, attempts: 0 });
  });

  it('DeadlineError is an Error', () => {
    expect(new DeadlineError('x', 1000)).toBeInstanceOf(Error);
  });
});

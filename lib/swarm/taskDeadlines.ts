// M7-13c-2b-1c: deadlines for the mission task path.
//
// The mission pipeline runs inside the browser tab and awaits every database write, tool run and model call in
// sequence. Before this module only the agent-loop model call had a deadline (withTimeout in executionLayer.ts), so
// ONE await that never settled — observed live: the timeline write right after a failed web.search — left the task
// 'running', the mission 'executing', and the next task unstarted, for ever. Nothing here changes what a task does;
// it only guarantees that no single await can hold the pipeline longer than a stated, named time.
//
// Three kinds of bound, by what the awaited thing is:
//   - side-effect writes (timeline events, execution log, runtime activity): bestEffort(), 15 s, NON-FATAL — a
//     timeout or error is logged with the step name and the task carries on;
//   - status-changing writes (claim, completed / failed, mission rollup): boundedStatusWrite(), 20 s, one retry,
//     and a final failure is logged with the task id instead of thrown;
//   - model / tool / context steps: withDeadline(), the caller turns the DeadlineError into an ordinary failure so the
//     existing retry rules apply.
// On top of these, TaskRunGuard lets the caller stop a task run that has been abandoned (its hard deadline fired) from
// writing anything afterwards.

/** Timeline / execution-log / runtime-activity writes. Non-fatal. */
export const SIDE_EFFECT_WRITE_TIMEOUT_MS = 15_000;
/** Writes that change a task's or the mission's status. One retry. */
export const STATUS_WRITE_TIMEOUT_MS = 20_000;
/** Upper bound for the tool-decision step (and context / settings / routing reads): min(task_timeout_ms, this). */
export const TOOL_STEP_MAX_MS = 60_000;
/** The whole executeTask run may take at most task_timeout_ms times this. */
export const TASK_HARD_DEADLINE_FACTOR = 2;
/** Matches mission_tasks.task_timeout_ms's column default. */
export const DEFAULT_TASK_TIMEOUT_MS = 90_000;

export class DeadlineError extends Error {
  readonly code = 'timeout';
  constructor(public readonly step: string, public readonly ms: number) {
    super(`${step} timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'DeadlineError';
  }
}

/** Rejects with a DeadlineError if `work` has not settled within `ms`. The timer is always cleared. */
export function withDeadline<T>(step: string, ms: number, work: Promise<T> | (() => Promise<T>)): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(step, ms)), ms);
    let promise: Promise<T>;
    try {
      promise = typeof work === 'function' ? work() : work;
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export interface DeadlineContext {
  taskId?: string | null;
  missionId?: string | null;
}

function describe(ctx: DeadlineContext): string {
  return `task=${ctx.taskId ?? '-'} mission=${ctx.missionId ?? '-'}`;
}

function reasonOf(err: unknown): { kind: 'timed out' | 'failed'; message: string } {
  return {
    kind: err instanceof DeadlineError ? 'timed out' : 'failed',
    message: err instanceof Error ? err.message : String(err),
  };
}

/** Runs a NON-FATAL side-effect write under SIDE_EFFECT_WRITE_TIMEOUT_MS. Never throws; logs and returns undefined on timeout / error. */
export async function bestEffort<T>(step: string, ctx: DeadlineContext, fn: () => Promise<T>): Promise<T | undefined> {
  const started = Date.now();
  try {
    return await withDeadline(step, SIDE_EFFECT_WRITE_TIMEOUT_MS, fn);
  } catch (err) {
    const { kind, message } = reasonOf(err);
    console.warn(`[swarm] ${step} ${kind}: ${message} (${describe(ctx)}, ${Date.now() - started}ms elapsed)`);
    return undefined;
  }
}

export type BoundedWrite<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs a status-changing write under STATUS_WRITE_TIMEOUT_MS, retrying ONCE on a timeout or a thrown error. Never throws:
 * when both attempts fail it logs an error carrying the task id and returns { ok: false }, so the pipeline can go on.
 * Only for writes that are safe to repeat (conditional / idempotent UPDATEs).
 */
export async function boundedStatusWrite<T>(step: string, ctx: DeadlineContext, fn: () => Promise<T>): Promise<BoundedWrite<T>> {
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { ok: true, value: await withDeadline(step, STATUS_WRITE_TIMEOUT_MS, fn) };
    } catch (err) {
      lastError = err;
      const { kind, message } = reasonOf(err);
      console.warn(`[swarm] ${step} ${kind} on attempt ${attempt}/2: ${message} (${describe(ctx)})`);
    }
  }
  const { kind, message } = reasonOf(lastError);
  console.error(`[swarm] ${step} could not be written — ${kind}: ${message} (${describe(ctx)}, ${Date.now() - started}ms elapsed). The pipeline continues; this status may be stale.`);
  return { ok: false };
}

/**
 * Shared between one executeTask() run and the code that supervises it. When the supervisor gives up on the run
 * (hard deadline), it sets `superseded`; the abandoned run checks the flag before every status write and stops, so
 * a late completion can never overwrite the timed-out state (the UPDATEs are ALSO conditional on the expected status).
 */
export interface TaskRunGuard {
  superseded: boolean;
  /** The step the run is currently in — used in the timeout reason ("no response from …"). */
  step: string;
  /** Attempts started so far. */
  attempts: number;
}

export function createTaskRunGuard(): TaskRunGuard {
  return { superseded: false, step: 'starting the task', attempts: 0 };
}

/** The hard deadline for one executeTask() run. */
export function taskHardDeadlineMs(taskTimeoutMs?: number | null): number {
  const base = typeof taskTimeoutMs === 'number' && taskTimeoutMs > 0 ? taskTimeoutMs : DEFAULT_TASK_TIMEOUT_MS;
  return base * TASK_HARD_DEADLINE_FACTOR;
}

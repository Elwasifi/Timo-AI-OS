// M7-13c-2b-1 — ONE truthful outcome model for a mission. PURE: no Supabase, no I/O.
//
// Before this, two places decided a mission's terminal status with different rules
// (unifiedOrchestrator.ts and missionEngine.recalculateProgress) and a third (buildMissionResponse) wrote the
// chat text from a boolean ("any failure"), so a mission where 0 of 2 tasks succeeded was announced as
// "completed with partial results". Now every consumer asks computeMissionOutcome().
//
// Product decisions (Amro):
//   - Simulation (Demo / sandbox / simulation mode) is a supported, intended way of working. A task whose result is
//     INTENDED-simulated counts as completed — but it is always tagged "Simulated" and never described as real work.
//   - A simulated result while the task ran in LIVE mode is an ANOMALY: it is NOT a success.
//   - Failure reasons stay visible everywhere (honesty).
//
// 'partial' is a database value since migration 20261106120000 (M7-13c-2b-2a): the writer stores DB status 'partial' for
// a partial outcome and keeps the full outcome in missions.metadata.outcome. If a database ever rejects the label (an
// environment without the migration), recalculateProgress falls back to status 'completed' + metadata.outcome.

import { dedupeJoinedFailureText } from '@/lib/utils/failureText';

export type OutcomeStatus = 'completed' | 'partial' | 'failed' | 'cancelled' | 'in_progress';

export type TaskOutcomeState =
  | 'succeeded' // completed, real work
  | 'simulated' // completed, INTENDED simulation (counts as a success, always tagged)
  | 'anomalous' // completed but simulated while the task ran in LIVE mode (NOT a success)
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'open'; // waiting / ready / running / awaiting_approval

/** The fields of a mission task this module reads. MissionTask satisfies it structurally. */
export interface OutcomeTaskInput {
  id: string;
  title: string;
  /** A task_queue_status value ('skipped' included since migration 20261106120000). Anything unknown is treated as 'open'. */
  status: string;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  assignedManager?: string | null;
  assignedWorker?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  retries?: number;
}

/** Structured report data for one task — the single source for both the BRIEF and the FULL renderers. */
export interface TaskReport {
  taskId: string;
  title: string;
  state: TaskOutcomeState;
  manager: string | null;
  worker: string | null;
  /** Method: the step names recorded for the task, in order. */
  method: string[];
  tools: string[];
  /** The task's result text (completed tasks only; '' otherwise). */
  result: string;
  durationMs: number | null;
  simulated: boolean;
  /** Why it failed / was skipped / is still open / is not counted. Human-readable, no raw JSON, capped. */
  reason: string | null;
  retries: number;
}

export interface OutcomeCounts {
  total: number;
  /** Completed, REAL work. */
  succeeded: number;
  /** Completed, intended-simulated (also counts toward "success", see isSuccess()). */
  simulated: number;
  failed: number;
  skipped: number;
  cancelled: number;
  open: number;
  /** Simulated while the task ran in LIVE mode: not a success. */
  anomalous: number;
}

export interface MissionOutcome {
  status: OutcomeStatus;
  /** At least one task was intended-simulated. */
  simulatedTag: boolean;
  counts: OutcomeCounts;
  /** resolved / total, 0..100 (resolved = every task that is not open). */
  progress: number;
  parts: {
    tasks: TaskReport[];
    /** failed + anomalous */
    failed: TaskReport[];
    /** open + skipped + cancelled */
    remaining: TaskReport[];
  };
}

export interface OutcomeOptions {
  /** The mission itself was cancelled. */
  missionCancelled?: boolean;
  /** Settle every open task as skipped ("never executed") — used when a mission is abandoned, never during a live run. */
  force?: boolean;
  /** The mission's own status; with no tasks, 'pending'/'planning' means "still being planned", anything else means failed. */
  missionStatus?: string;
}

export const OPEN_TASK_STATUSES: readonly string[] = ['waiting', 'ready', 'running', 'awaiting_approval'];
// About 200 in the brief; 280 so the app's OWN readable sentences (e.g. the Gemini quota message, ~220 characters, whose
// last clause tells the user what to do) are never cut off mid-sentence. Provider text is far longer than this and is capped.
export const REASON_CAP = 280;
const SIMULATED_NOTE_PREFIX = 'Simulated execution of "';

/** Successes for the "every task succeeded" / "at least one succeeded" rules: real work OR intended simulation. */
export function isSuccess(state: TaskOutcomeState): boolean {
  return state === 'succeeded' || state === 'simulated';
}

/** The ONE progress formula (resolved / total, 0..100). Used by recalculateProgress and the progress timeline event. */
export function resolvedProgress(resolved: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((resolved / total) * 100)));
}

/**
 * Turns an error text into a short human-readable reason: no raw JSON (a provider's JSON body is reduced to its
 * "message" field, or cut at the first brace), whitespace collapsed, repeated sentences collapsed to one, capped at
 * 280 characters (REASON_CAP).
 */
export function cleanReason(raw: string | null | undefined): string {
  let text = (raw ?? '').trim();
  if (!text) return 'No reason was recorded.';
  if (text.includes('{')) {
    const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    if (m) {
      const prefix = text.slice(0, text.indexOf('{')).trim();
      const inner = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
      text = prefix && !prefix.endsWith(inner) ? `${prefix} ${inner}` : inner;
    } else {
      text = text.slice(0, text.indexOf('{')).trim() || 'The failure details are not available as readable text.';
    }
  }
  text = text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return 'No reason was recorded.';
  // M7-13c-2b-1b: older rows hold the same sentence several times joined by "; " — show each distinct reason once.
  text = dedupeJoinedFailureText(text);
  return text.length > REASON_CAP ? `${text.slice(0, REASON_CAP - 1).trimEnd()}…` : text;
}

/** Reads the simulation marker from a task result: structured flag first, legacy text prefix as a fallback. */
export function readSimulation(result: Record<string, unknown> | null | undefined): { simulated: boolean; intended: boolean; executionMode: string | null } {
  const r = result ?? {};
  const mode = typeof r.executionMode === 'string' ? r.executionMode : null;
  if (r.simulated === true) {
    return { simulated: true, intended: mode !== 'live', executionMode: mode };
  }
  // Legacy rows (before the structured marker): only the note text exists, and no executionMode was recorded.
  if (mode === null && typeof r.output === 'string' && r.output.startsWith(SIMULATED_NOTE_PREFIX)) {
    return { simulated: true, intended: true, executionMode: null };
  }
  return { simulated: false, intended: false, executionMode: mode };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function methodOf(result: Record<string, unknown>): string[] {
  const steps = result.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => (s && typeof s === 'object' && typeof (s as { step?: unknown }).step === 'string' ? ((s as { step: string }).step) : ''))
    .filter(Boolean);
}

function durationOf(t: OutcomeTaskInput): number | null {
  if (!t.startedAt || !t.completedAt) return null;
  const ms = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function reportFor(t: OutcomeTaskInput, force: boolean): TaskReport {
  const result = (t.result && typeof t.result === 'object' ? t.result : {}) as Record<string, unknown>;
  const agent = (result.agent && typeof result.agent === 'object' ? result.agent : {}) as { manager?: unknown; worker?: unknown };
  const manager = (typeof agent.manager === 'string' && agent.manager) || t.assignedManager || null;
  const worker = (typeof agent.worker === 'string' && agent.worker) || t.assignedWorker || null;
  const sim = readSimulation(result);

  let state: TaskOutcomeState;
  let reason: string | null = null;
  switch (t.status) {
    case 'completed':
      if (sim.simulated && !sim.intended) {
        state = 'anomalous';
        reason = 'Not counted: this task ran in Live mode but its result is only a simulation, so no real action was confirmed.';
      } else {
        state = sim.simulated ? 'simulated' : 'succeeded';
      }
      break;
    case 'failed':
      state = 'failed';
      reason = cleanReason(t.errorMessage);
      break;
    case 'skipped':
      state = 'skipped';
      reason = cleanReason(t.errorMessage ?? 'Skipped.');
      break;
    case 'cancelled':
      state = 'cancelled';
      reason = t.errorMessage ? cleanReason(t.errorMessage) : 'Cancelled before it ran.';
      break;
    default:
      if (force) {
        state = 'skipped';
        reason = 'Never executed — the mission ended before this task ran.';
      } else {
        state = 'open';
        reason = t.status === 'awaiting_approval'
          ? 'Waiting for a human approval.'
          : t.status === 'running'
            ? 'Still running.'
            : 'Not started yet.';
      }
  }

  const output = state === 'succeeded' || state === 'simulated' || state === 'anomalous'
    ? (typeof result.output === 'string' ? result.output : '')
    : '';

  return {
    taskId: t.id,
    title: t.title,
    state,
    manager,
    worker,
    method: methodOf(result),
    tools: asStringArray(result.tools),
    result: output,
    durationMs: durationOf(t),
    simulated: sim.simulated,
    reason,
    retries: typeof t.retries === 'number' ? t.retries : 0,
  };
}

/**
 * The mission outcome. Rules, in order:
 *   1. mission cancelled                       -> cancelled
 *   2. no tasks                                -> in_progress while pending/planning, otherwise failed
 *   3. any open task (and not force)           -> in_progress
 *   4. every task succeeded (real or intended-simulated) -> completed (simulatedTag if any was simulated)
 *   5. at least one succeeded and at least one failed / skipped / cancelled / anomalous -> partial
 *   6. none succeeded                          -> failed
 */
export function computeMissionOutcome(tasks: OutcomeTaskInput[], opts: OutcomeOptions = {}): MissionOutcome {
  const force = opts.force === true;
  const reports = tasks.map((t) => reportFor(t, force));

  const counts: OutcomeCounts = { total: reports.length, succeeded: 0, simulated: 0, failed: 0, skipped: 0, cancelled: 0, open: 0, anomalous: 0 };
  for (const r of reports) {
    switch (r.state) {
      case 'succeeded': counts.succeeded++; break;
      case 'simulated': counts.simulated++; break;
      case 'anomalous': counts.anomalous++; break;
      case 'failed': counts.failed++; break;
      case 'skipped': counts.skipped++; break;
      case 'cancelled': counts.cancelled++; break;
      case 'open': counts.open++; break;
    }
  }

  const successes = counts.succeeded + counts.simulated;
  const notDone = counts.failed + counts.skipped + counts.cancelled + counts.anomalous;
  const resolved = counts.total - counts.open;

  let status: OutcomeStatus;
  if (opts.missionCancelled) {
    status = 'cancelled';
  } else if (counts.total === 0) {
    status = opts.missionStatus === 'pending' || opts.missionStatus === 'planning' ? 'in_progress' : 'failed';
  } else if (counts.open > 0) {
    status = 'in_progress';
  } else if (successes === counts.total) {
    status = 'completed';
  } else if (successes > 0 && notDone > 0) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  return {
    status,
    simulatedTag: counts.simulated > 0,
    counts,
    progress: resolvedProgress(resolved, counts.total),
    parts: {
      tasks: reports,
      failed: reports.filter((r) => r.state === 'failed' || r.state === 'anomalous'),
      remaining: reports.filter((r) => r.state === 'open' || r.state === 'skipped' || r.state === 'cancelled'),
    },
  };
}

/** What recalculateProgress stores in missions.metadata.outcome (small and stable; the per-task detail lives on the tasks). */
export function outcomeMetadata(outcome: MissionOutcome, computedAt: string = new Date().toISOString()) {
  return { status: outcome.status, simulatedTag: outcome.simulatedTag, counts: outcome.counts, computedAt };
}

/**
 * True when a database error is Postgres rejecting an enum label it does not have (SQLSTATE 22P02,
 * "invalid input value for enum ..."). Used ONLY by the 'partial' safety fallback in recalculateProgress.
 */
export function isInvalidEnumValueError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === '22P02' || (typeof e.message === 'string' && /invalid input value for enum/i.test(e.message));
}

/** The runtime-state label (lib/swarm/runtimeStore.ts ExecutionState) for an outcome. */
export function executionStateOf(outcome: MissionOutcome): 'executing' | 'completed' | 'failed' {
  if (outcome.status === 'in_progress') return 'executing';
  return outcome.status === 'completed' || outcome.status === 'partial' ? 'completed' : 'failed';
}

/** The mission_status a settled outcome is stored as. 'partial' is its own label (migration 20261106120000). */
export function dbStatusOf(outcome: MissionOutcome): 'completed' | 'partial' | 'failed' | 'cancelled' | null {
  switch (outcome.status) {
    case 'completed':
      return 'completed';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return null; // in_progress: no terminal status
  }
}

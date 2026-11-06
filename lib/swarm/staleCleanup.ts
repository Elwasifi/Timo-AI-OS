// M7-13c-2b-3 (Part D) — stale-mission cleanup: the PURE rules plus the settle sequence behind an injected dependency set.
// Used by scripts/cleanup-stale-missions.ts (a local admin script — NOT an API route, not reachable from the browser).
//
// DEFAULT IS DRY-RUN. Nothing here writes unless settleStaleMission() is called, and the script only calls it for
// --execute together with an explicit list of mission ids, every one of which must still be a current candidate.
// NO row is ever deleted.
//
// Candidate rule (all thresholds are the named constants below, and the script prints them):
//   status in (pending, planning, ready, executing, reviewing)   — never paused, never a terminal status
//   AND updated_at is older than STALE_MISSION_AGE_MS
//   AND no runtime_activity for the mission within NO_RUNTIME_ACTIVITY_WINDOW_MS
//   AND no task awaiting approval (a human decision is pending — never touched)
//   AND no task changed within STALE_MISSION_AGE_MS (a conservative extra guard: a recently touched task is not abandoned)
//
// Settling a candidate (--execute): open tasks (waiting / ready) -> 'skipped'; a task still 'running' -> 'failed'
// ("Interrupted"); then the mission settles through the SAME outcome rules as a live run (computeMissionOutcome ->
// failed / partial / completed) with a conditional claim from a non-terminal status, metadata.outcome + metadata.cleanup,
// and timeline events carrying {cleanup:true, reason:'abandoned'}. Re-running is safe: a settled mission is no longer a candidate.

import { computeMissionOutcome, dbStatusOf, outcomeMetadata, type MissionOutcome, type OutcomeTaskInput } from './missionOutcome';
import type { MissionStatus } from './types';

export const STALE_MISSION_AGE_MS = 6 * 60 * 60 * 1000;
export const NO_RUNTIME_ACTIVITY_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Missions older than this (but under the stale threshold) are listed as "close to the threshold". */
export const NEAR_THRESHOLD_MS = 3 * 60 * 60 * 1000;
export const CANDIDATE_STATUSES: MissionStatus[] = ['pending', 'planning', 'ready', 'executing', 'reviewing'];

export const SKIP_REASON = 'Never executed — the mission was abandoned and cleaned up';
export const INTERRUPT_REASON = 'Interrupted — the mission was abandoned and cleaned up';
export const CLEANUP_EVENT_METADATA = { cleanup: true, reason: 'abandoned' } as const;

const KNOWN_TASK_STATUSES = new Set(['waiting', 'ready', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'skipped']);
const TERMINAL_MISSION_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

export interface StaleMissionInput {
  id: string;
  tenantId: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface StaleTaskInput {
  id: string;
  title?: string;
  status: string;
  startedAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
  assignedManager?: string | null;
  assignedWorker?: string | null;
  retries?: number;
  completedAt?: string | null;
}

export type StaleVerdict = 'candidate' | 'not_stale' | 'excluded';

export interface StaleEvaluation {
  verdict: StaleVerdict;
  /** The exact reasons, in plain words (printed by the dry run). */
  reasons: string[];
  ageMs: number;
  /** Not stale yet but at least NEAR_THRESHOLD_MS old (listed so nothing close to the threshold is invisible). */
  nearThreshold: boolean;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${String(min % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ageOf(iso: string | null | undefined, now: Date): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? now.getTime() - t : Number.NaN;
}

/**
 * The candidate rule. `lastActivityAt` is the newest runtime_activity time for the mission (null = none at all).
 * An unparsable updated_at is never a candidate (we do not clean up what we cannot date).
 */
export function evaluateStaleMission(input: { mission: StaleMissionInput; tasks: ReadonlyArray<StaleTaskInput>; lastActivityAt: string | null; now: Date }): StaleEvaluation {
  const { mission, tasks, lastActivityAt, now } = input;
  const ageMs = ageOf(mission.updatedAt, now);
  const reasons: string[] = [];
  const out = (verdict: StaleVerdict): StaleEvaluation => ({ verdict, reasons, ageMs, nearThreshold: verdict === 'not_stale' && ageMs >= NEAR_THRESHOLD_MS });

  if (mission.status === 'paused') {
    reasons.push('paused missions are never cleaned up');
    return out('excluded');
  }
  if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
    reasons.push(`already ended (${mission.status})`);
    return out('excluded');
  }
  if (!CANDIDATE_STATUSES.includes(mission.status as MissionStatus)) {
    reasons.push(`status "${mission.status}" is not a cleanup status`);
    return out('excluded');
  }
  const awaiting = tasks.filter((t) => t.status === 'awaiting_approval').length;
  if (awaiting > 0) {
    reasons.push(`${awaiting} task(s) awaiting approval — a human decision is pending`);
    return out('excluded');
  }
  const unknown = tasks.filter((t) => !KNOWN_TASK_STATUSES.has(t.status));
  if (unknown.length > 0) {
    reasons.push(`unknown task status "${unknown[0].status}"`);
    return out('excluded');
  }
  if (!Number.isFinite(ageMs)) {
    reasons.push('updated_at is missing or unreadable');
    return out('excluded');
  }
  if (ageMs < STALE_MISSION_AGE_MS) {
    reasons.push(`updated ${formatDuration(ageMs)} ago (threshold ${formatDuration(STALE_MISSION_AGE_MS)})`);
    return out('not_stale');
  }
  const activityAge = ageOf(lastActivityAt, now);
  if (lastActivityAt && Number.isFinite(activityAge) && activityAge < NO_RUNTIME_ACTIVITY_WINDOW_MS) {
    reasons.push(`runtime activity ${formatDuration(activityAge)} ago (window ${formatDuration(NO_RUNTIME_ACTIVITY_WINDOW_MS)})`);
    return out('not_stale');
  }
  const recentTask = tasks.find((t) => {
    const a = ageOf(t.updatedAt, now);
    return Number.isFinite(a) && a < STALE_MISSION_AGE_MS;
  });
  if (recentTask) {
    reasons.push('a task changed within the threshold');
    return out('not_stale');
  }
  reasons.push(`status ${mission.status}, updated ${formatDuration(ageMs)} ago (older than ${formatDuration(STALE_MISSION_AGE_MS)})`);
  reasons.push(lastActivityAt ? `last runtime activity ${formatDuration(activityAge)} ago` : 'no runtime activity recorded');
  return out('candidate');
}

export interface SettlementPlan {
  /** waiting / ready tasks that would become 'skipped'. */
  toSkip: string[];
  /** running tasks that would become 'failed' ("Interrupted"). */
  toFail: string[];
  /** What the mission would settle to (null only if the data is inconsistent and must not be touched). */
  wouldStatus: 'failed' | 'partial' | 'completed' | null;
  outcome: MissionOutcome | null;
  explanation: string;
}

/** The task states after the cleanup's task writes, as the outcome model sees them. */
function settledTaskView(tasks: ReadonlyArray<StaleTaskInput>): OutcomeTaskInput[] {
  return tasks.map((t) => {
    const status = t.status === 'waiting' || t.status === 'ready' ? 'skipped' : t.status === 'running' ? 'failed' : t.status;
    const errorMessage = t.status === 'waiting' || t.status === 'ready' ? SKIP_REASON : t.status === 'running' ? INTERRUPT_REASON : t.errorMessage ?? null;
    return {
      id: t.id, title: t.title ?? t.id, status, result: t.result ?? null, errorMessage,
      assignedManager: t.assignedManager ?? null, assignedWorker: t.assignedWorker ?? null,
      startedAt: t.startedAt ?? null, completedAt: t.completedAt ?? null, retries: t.retries ?? 0,
    };
  });
}

/** What the cleanup WOULD do to one candidate, using the same outcome rules as a live mission. */
export function planSettlement(tasks: ReadonlyArray<StaleTaskInput>): SettlementPlan {
  const toSkip = tasks.filter((t) => t.status === 'waiting' || t.status === 'ready').map((t) => t.id);
  const toFail = tasks.filter((t) => t.status === 'running').map((t) => t.id);
  if (tasks.length === 0) {
    return { toSkip, toFail, wouldStatus: 'failed', outcome: null, explanation: 'no tasks were ever created' };
  }
  const outcome = computeMissionOutcome(settledTaskView(tasks));
  const wouldStatus = dbStatusOf(outcome);
  if (wouldStatus === null || wouldStatus === 'cancelled') {
    return { toSkip, toFail, wouldStatus: null, outcome, explanation: `inconsistent task data (${outcome.status}) — would not be touched` };
  }
  const c = outcome.counts;
  const parts = [`${c.succeeded + c.simulated} succeeded`, `${c.failed + c.anomalous} failed`, `${c.skipped} skipped`, `${c.cancelled} cancelled`];
  return { toSkip, toFail, wouldStatus, outcome, explanation: `${parts.join(', ')} of ${c.total} tasks after cleanup` };
}

// ---- Arguments --------------------------------------------------------------------------------------------------------

export interface CleanupArgs {
  execute: boolean;
  ids: string[];
  error: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the script's arguments. Default = dry run. `--execute` REQUIRES an explicit id list (--ids a,b,c and/or --ids-file path;
 * `readFile` is injected so this stays pure). Any unknown flag, malformed id, or --execute without ids is an error (error !== null).
 */
export function parseCleanupArgs(argv: ReadonlyArray<string>, readFile: (path: string) => string): CleanupArgs {
  let execute = false;
  const ids: string[] = [];
  const fail = (error: string): CleanupArgs => ({ execute, ids: [], error });
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') { execute = true; continue; }
    if (a === '--dry-run') continue;
    if (a === '--ids' || a === '--ids-file') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return fail(`${a} needs a value`);
      i++;
      let text: string;
      if (a === '--ids') text = value;
      else {
        try { text = readFile(value); } catch (e) { return fail(`cannot read ${value}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      for (const raw of text.split(/[\s,]+/)) {
        const id = raw.trim();
        if (!id) continue;
        if (!UUID.test(id)) return fail(`"${id}" is not a mission id`);
        if (!ids.includes(id.toLowerCase())) ids.push(id.toLowerCase());
      }
      continue;
    }
    return fail(`unknown argument "${a}"`);
  }
  if (execute && ids.length === 0) return fail('--execute requires an explicit list of mission ids (--ids a,b,c or --ids-file path)');
  if (!execute && ids.length > 0) return { execute, ids, error: null }; // ids without --execute: still a dry run (ids only highlight rows)
  return { execute, ids, error: null };
}

/** Splits the requested ids into those that are current candidates and those refused (with the reason). */
export function validateExecuteIds(requested: ReadonlyArray<string>, candidateIds: ReadonlyArray<string>): { accepted: string[]; refused: Array<{ id: string; reason: string }> } {
  const set = new Set(candidateIds.map((c) => c.toLowerCase()));
  const accepted: string[] = [];
  const refused: Array<{ id: string; reason: string }> = [];
  for (const id of requested) {
    if (set.has(id.toLowerCase())) accepted.push(id);
    else refused.push({ id, reason: 'not a current stale candidate' });
  }
  return { accepted, refused };
}

// ---- Settle sequence (--execute) -------------------------------------------------------------------------------------

export interface MissionState {
  mission: StaleMissionInput;
  tasks: StaleTaskInput[];
  lastActivityAt: string | null;
}

export interface CleanupDeps {
  now(): Date;
  loadState(missionId: string): Promise<MissionState | null>;
  skipOpenTasks(missionId: string, reason: string, meta: Record<string, unknown>): Promise<Array<{ id: string }>>;
  failRunningTasks(missionId: string, taskIds: string[], reason: string, meta: Record<string, unknown>): Promise<Array<{ id: string }>>;
  claim(missionId: string, status: 'completed' | 'partial' | 'failed', progress: number): Promise<boolean>;
  writeMetadata(missionId: string, metadata: Record<string, unknown>): Promise<void>;
  recordMissionEvent(missionId: string, eventType: 'mission_failed' | 'mission_partial' | 'mission_completed', title: string, detail: string, meta: Record<string, unknown>): Promise<void>;
}

export interface SettleReport {
  missionId: string;
  settled: boolean;
  status: 'failed' | 'partial' | 'completed' | null;
  skipped: number;
  interrupted: number;
  /** Why nothing (or not everything) happened. */
  note: string;
}

/**
 * Settles ONE stale mission. Re-checks it first (it must still be a candidate NOW), then: skip open tasks, fail stale running tasks,
 * recompute the outcome from the real rows, claim the terminal status from a non-terminal one, write metadata, record the event.
 * Never throws for an expected "no" (not a candidate any more / lost the claim): it reports it. Deletes nothing.
 */
export async function settleStaleMission(missionId: string, deps: CleanupDeps): Promise<SettleReport> {
  const none = (note: string, extra: Partial<SettleReport> = {}): SettleReport => ({ missionId, settled: false, status: null, skipped: 0, interrupted: 0, note, ...extra });

  const before = await deps.loadState(missionId);
  if (!before) return none('mission not found');
  const check = evaluateStaleMission({ mission: before.mission, tasks: before.tasks, lastActivityAt: before.lastActivityAt, now: deps.now() });
  if (check.verdict !== 'candidate') return none(`no longer a stale candidate: ${check.reasons.join('; ')}`);

  const plan = planSettlement(before.tasks);
  if (plan.wouldStatus === null) return none(plan.explanation);

  const skipped = plan.toSkip.length > 0 ? await deps.skipOpenTasks(missionId, SKIP_REASON, { ...CLEANUP_EVENT_METADATA }) : [];
  const failed = plan.toFail.length > 0 ? await deps.failRunningTasks(missionId, plan.toFail, INTERRUPT_REASON, { ...CLEANUP_EVENT_METADATA }) : [];

  // Settle from what the database NOW says (a task may have finished between the check and the writes).
  const after = await deps.loadState(missionId);
  if (!after) return none('mission disappeared during cleanup', { skipped: skipped.length, interrupted: failed.length });
  let status: 'failed' | 'partial' | 'completed';
  let outcome: MissionOutcome | null = null;
  if (after.tasks.length === 0) {
    status = 'failed';
  } else {
    outcome = computeMissionOutcome(after.tasks.map((t) => ({
      id: t.id, title: t.title ?? t.id, status: t.status, result: t.result ?? null, errorMessage: t.errorMessage ?? null,
      assignedManager: t.assignedManager ?? null, assignedWorker: t.assignedWorker ?? null,
      startedAt: t.startedAt ?? null, completedAt: t.completedAt ?? null, retries: t.retries ?? 0,
    })));
    const db = dbStatusOf(outcome);
    if (db === null || db === 'cancelled') {
      return none(`tasks are not all resolved after cleanup (${outcome.status}) — the mission was left as it is`, { skipped: skipped.length, interrupted: failed.length });
    }
    status = db;
  }

  const progress = outcome ? outcome.progress : 0;
  const claimed = await deps.claim(missionId, status, progress);
  if (!claimed) return none('another caller settled this mission first (or it is no longer in a non-terminal status)', { skipped: skipped.length, interrupted: failed.length });

  const at = deps.now().toISOString();
  await deps.writeMetadata(missionId, {
    ...(after.mission.metadata ?? {}),
    ...(outcome ? { outcome: outcomeMetadata(outcome, at) } : {}),
    cleanup: { at, reason: 'abandoned', skippedTasks: skipped.length, interruptedTasks: failed.length },
  });

  const eventType = status === 'failed' ? 'mission_failed' : status === 'partial' ? 'mission_partial' : 'mission_completed';
  const verb = status === 'failed' ? 'failed' : status === 'partial' ? 'partially completed' : 'completed';
  const detail = `Cleaned up: the mission was abandoned. ${plan.explanation}.`;
  await deps.recordMissionEvent(missionId, eventType, `Mission ${verb}: ${after.mission.title}`, detail, { ...CLEANUP_EVENT_METADATA, progress, reason: 'abandoned' });

  return { missionId, settled: true, status, skipped: skipped.length, interrupted: failed.length, note: detail };
}

/** The BEFORE snapshot written ahead of --execute: enough to review or restore every change by hand. */
export function buildBeforeSnapshot(states: ReadonlyArray<MissionState>, now: Date): Record<string, unknown> {
  return {
    createdAt: now.toISOString(),
    note: 'State of each mission and its tasks BEFORE the stale-mission cleanup. Restore by hand if needed; the cleanup deletes nothing.',
    missions: states.map((s) => ({
      id: s.mission.id,
      tenantId: s.mission.tenantId,
      title: s.mission.title,
      status: s.mission.status,
      progress: s.mission.progress,
      updatedAt: s.mission.updatedAt,
      metadata: s.mission.metadata ?? {},
      tasks: s.tasks.map((t) => ({ id: t.id, status: t.status, startedAt: t.startedAt ?? null, completedAt: t.completedAt ?? null, errorMessage: t.errorMessage ?? null })),
    })),
  };
}

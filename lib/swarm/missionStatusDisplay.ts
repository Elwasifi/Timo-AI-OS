// M7-13c-2b-1 — display helpers for a mission's status that NEVER assume the value is one they know.
//
// The UI used to index a Record by the status string (`STATUS_CONFIG[mission.status].color`), so a status the UI had
// not heard of — e.g. a future 'partial' (a real status since migration 20261106120000) — was a runtime TypeError in the mission card, a never-ending elapsed-time
// clock on the list, and a silently misleading colour on the detail page. These helpers give every unknown status a
// neutral, sane presentation, and treat it as "ended" (a status we do not recognise is not a running mission).
// PURE — no React, so it is unit-testable.

export interface MissionStatusDisplay {
  color: string;
  label: string;
}

const KNOWN: Record<string, MissionStatusDisplay> = {
  pending: { color: '#F97316', label: 'Pending' },
  planning: { color: '#F97316', label: 'Planning' },
  ready: { color: '#EAB308', label: 'Ready' },
  executing: { color: '#00F3FF', label: 'Executing' },
  reviewing: { color: '#A855F7', label: 'Reviewing' },
  completed: { color: '#10B981', label: 'Completed' },
  failed: { color: '#EF4444', label: 'Failed' },
  cancelled: { color: '#64748B', label: 'Cancelled' },
  partial: { color: '#F59E0B', label: 'Partial' },
  paused: { color: '#94A3B8', label: 'Paused' },
};

/** The statuses of a mission that is still going (or waiting). Anything else — known terminal or unknown — is "ended". */
const ACTIVE = new Set(['pending', 'planning', 'ready', 'executing', 'reviewing', 'paused']);

export const NEUTRAL_STATUS_COLOR = '#94A3B8';

function humanize(status: string): string {
  const t = status.replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Unknown';
}

/** Colour and label for any status string, known or not. */
export function missionStatusDisplay(status: string | null | undefined): MissionStatusDisplay {
  const key = (status ?? '').toString();
  return KNOWN[key] ?? { color: NEUTRAL_STATUS_COLOR, label: humanize(key) };
}

const TASK_KNOWN: Record<string, MissionStatusDisplay> = {
  waiting: { color: '#94A3B8', label: 'Waiting' },
  ready: { color: '#EAB308', label: 'Ready' },
  running: { color: '#00F3FF', label: 'Running' },
  completed: { color: '#10B981', label: 'Completed' },
  failed: { color: '#EF4444', label: 'Failed' },
  cancelled: { color: '#64748B', label: 'Cancelled' },
  awaiting_approval: { color: '#A855F7', label: 'Awaiting approval' },
  // Muted on purpose: a skipped task never ran — it is neither a success nor a failure.
  skipped: { color: '#64748B', label: 'Skipped' },
};

/** Colour and label for any task status string, known or not (same defensive fallback as missionStatusDisplay). */
export function taskStatusDisplay(status: string | null | undefined): MissionStatusDisplay {
  const key = (status ?? '').toString();
  return TASK_KNOWN[key] ?? { color: NEUTRAL_STATUS_COLOR, label: humanize(key) };
}

/** Task statuses that are finished for good: the task will never run (again). Mirrors lib/swarm/missionOutcome.ts's "not open". */
const RESOLVED_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'skipped']);

/**
 * The mission detail page's progress caption. Replaces the bare "N%" (which showed a red "100%" on a FAILED mission):
 * "N of M tasks resolved" plus the outcome label — "In progress" while the mission is still going, otherwise the
 * status label (Completed / Partial / Failed / Cancelled).
 */
export function missionProgressLabel(tasks: ReadonlyArray<{ status: string }>, missionStatus: string | null | undefined): string {
  if (tasks.length === 0) return 'No tasks yet';
  const resolved = tasks.filter((t) => RESOLVED_TASK_STATUSES.has(t.status)).length;
  const outcome = isEndedMissionStatus(missionStatus) || missionStatus === 'paused' || missionStatus === 'pending' ? missionStatusDisplay(missionStatus).label : 'In progress';
  return `${resolved} of ${tasks.length} tasks resolved · ${outcome}`;
}

/** True for every status except the still-going ones — so an unrecognised status never keeps an elapsed clock ticking. */
export function isEndedMissionStatus(status: string | null | undefined): boolean {
  return !ACTIVE.has((status ?? '').toString());
}

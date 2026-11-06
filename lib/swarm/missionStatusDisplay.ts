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
  return missionProgressLabelFromCounts(countResolvedTasks(tasks), missionStatus);
}

/** M7-13c-2b-3: real task counts of one mission (resolved = completed / failed / cancelled / skipped). */
export interface MissionTaskCounts {
  resolved: number;
  total: number;
}

export function countResolvedTasks(tasks: ReadonlyArray<{ status: string }>): MissionTaskCounts {
  return { resolved: tasks.filter((t) => RESOLVED_TASK_STATUSES.has(t.status)).length, total: tasks.length };
}

function outcomeWordOf(missionStatus: string | null | undefined): string {
  return isEndedMissionStatus(missionStatus) || missionStatus === 'paused' || missionStatus === 'pending' ? missionStatusDisplay(missionStatus).label : 'In progress';
}

/** "N of M tasks resolved · <outcome>" from counts (shared by the detail page and the list card). */
export function missionProgressLabelFromCounts(counts: MissionTaskCounts, missionStatus: string | null | undefined): string {
  if (counts.total === 0) return 'No tasks yet';
  return `${counts.resolved} of ${counts.total} tasks resolved · ${outcomeWordOf(missionStatus)}`;
}

export interface MissionCardProgress {
  /** The mission is over (completed / partial / failed / cancelled / unknown status). */
  ended: boolean;
  /** An ended mission must NOT show a bare "100%" (a failed mission at "100%" read as success): it shows the caption instead. */
  showPercent: boolean;
  /** Outcome label and real task counts, e.g. "Failed · 0 of 2 tasks resolved". Empty for a running mission (it keeps its live progress). */
  caption: string;
}

/**
 * M7-13c-2b-3: what the mission list card shows under its progress bar. Ended missions show the outcome label and the REAL
 * "N of M tasks resolved" (counts come from mission_tasks); if the counts are not available it falls back to the mission's
 * estimated_tasks and says so ("~M tasks planned"). Running missions keep their live progress.
 */
export function missionCardProgress(input: {
  status: string | null | undefined;
  estimatedTasks?: number | null;
  counts?: MissionTaskCounts | null;
}): MissionCardProgress {
  if (!isEndedMissionStatus(input.status)) return { ended: false, showPercent: true, caption: '' };
  const label = missionStatusDisplay(input.status).label;
  const counts = input.counts;
  if (counts && counts.total > 0) return { ended: true, showPercent: false, caption: `${label} · ${counts.resolved} of ${counts.total} tasks resolved` };
  if (counts && counts.total === 0) return { ended: true, showPercent: false, caption: `${label} · no tasks were created` };
  const planned = input.estimatedTasks ?? 0;
  return { ended: true, showPercent: false, caption: planned > 0 ? `${label} · ~${planned} tasks planned` : label };
}

export const MISSION_TABS = ['All', 'Active', 'Pending', 'Completed', 'Partial', 'Failed'] as const;

/**
 * M7-13c-2b-3: the empty-state text of the missions list. It names the tab ("No partial missions"); "All" keeps the original
 * "No Active Missions" text and is only used when there are truly no missions at all; a search with no hit says so.
 */
export function missionsEmptyState(tab: string, opts: { totalMissions: number; query?: string }): { title: string; description: string } {
  const how = 'Missions are launched by asking Temo to build, create, or automate something from Chat.';
  const q = (opts.query ?? '').trim();
  if (q) return { title: 'No matching missions', description: `No missions in this view match "${q}".` };
  switch (tab) {
    case 'Active': return { title: 'No active missions', description: `Nothing is being planned or executed right now. ${how}` };
    case 'Pending': return { title: 'No pending missions', description: `No mission is waiting or paused. ${how}` };
    case 'Completed': return { title: 'No completed missions', description: `No mission has completed yet. ${how}` };
    case 'Partial': return { title: 'No partial missions', description: 'No mission has finished with only some of its tasks succeeding.' };
    case 'Failed': return { title: 'No failed missions', description: 'No mission has failed or been cancelled.' };
    default:
      return opts.totalMissions === 0
        ? { title: 'No Active Missions', description: `No autonomous goals match your filters. ${how}` }
        : { title: 'No missions in this view', description: how };
  }
}

/** Which statuses belong to which list tab (moved out of the page so it is unit-testable). */
export function missionMatchesTab(tab: string, status: string): boolean {
  switch (tab) {
    case 'Active': return status === 'planning' || status === 'ready' || status === 'executing' || status === 'reviewing';
    case 'Pending': return status === 'pending' || status === 'paused';
    case 'Completed': return status === 'completed';
    case 'Partial': return status === 'partial';
    case 'Failed': return status === 'failed' || status === 'cancelled';
    default: return true;
  }
}

/** True for every status except the still-going ones — so an unrecognised status never keeps an elapsed clock ticking. */
export function isEndedMissionStatus(status: string | null | undefined): boolean {
  return !ACTIVE.has((status ?? '').toString());
}

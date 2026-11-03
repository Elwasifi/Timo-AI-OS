// M7-13c-2b-1 — display helpers for a mission's status that NEVER assume the value is one they know.
//
// The UI used to index a Record by the status string (`STATUS_CONFIG[mission.status].color`), so a status the UI had
// not heard of — e.g. a future 'partial' — was a runtime TypeError in the mission card, a never-ending elapsed-time
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

/** True for every status except the still-going ones — so an unrecognised status never keeps an elapsed clock ticking. */
export function isEndedMissionStatus(status: string | null | undefined): boolean {
  return !ACTIVE.has((status ?? '').toString());
}

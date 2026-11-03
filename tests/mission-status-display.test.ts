// M7-13c-2b-1: defensive UI — a mission status the UI has not heard of (e.g. a future 'partial') must never crash the
// mission card (`STATUS_CONFIG[status].color` was a TypeError), keep an elapsed clock ticking, or borrow the
// "executing" colour. The components use these pure helpers; vitest here has no JSX transform, so the helpers are the
// testable surface.

import { describe, it, expect } from 'vitest';
import { missionStatusDisplay, isEndedMissionStatus, NEUTRAL_STATUS_COLOR } from '@/lib/swarm/missionStatusDisplay';

describe('missionStatusDisplay', () => {
  it.each([
    ['pending', '#F97316', 'Pending'], ['planning', '#F97316', 'Planning'], ['ready', '#EAB308', 'Ready'],
    ['executing', '#00F3FF', 'Executing'], ['reviewing', '#A855F7', 'Reviewing'], ['completed', '#10B981', 'Completed'],
    ['failed', '#EF4444', 'Failed'], ['cancelled', '#64748B', 'Cancelled'], ['paused', '#94A3B8', 'Paused'],
  ])('known status %s keeps exactly the colour and label the card always had', (status, color, label) => {
    expect(missionStatusDisplay(status)).toEqual({ color, label });
  });

  it('an unknown status gets a neutral colour and a humanised label — never undefined, never the "executing" cyan', () => {
    const d = missionStatusDisplay('partial');
    expect(d).toEqual({ color: NEUTRAL_STATUS_COLOR, label: 'Partial' });
    expect(d.color).not.toBe('#00F3FF');
    expect(missionStatusDisplay('awaiting_review').label).toBe('Awaiting review');
  });

  it.each([[undefined], [null], ['']])('a missing status (%j) is "Unknown" and neutral, not a crash', (s) => {
    expect(missionStatusDisplay(s as never)).toEqual({ color: NEUTRAL_STATUS_COLOR, label: 'Unknown' });
  });
});

describe('isEndedMissionStatus (drives the elapsed clock on the missions list)', () => {
  it.each(['pending', 'planning', 'ready', 'executing', 'reviewing', 'paused'])('%s is still going: the clock runs', (s) => {
    expect(isEndedMissionStatus(s)).toBe(false);
  });
  it.each(['completed', 'failed', 'cancelled'])('%s is ended', (s) => {
    expect(isEndedMissionStatus(s)).toBe(true);
  });
  it('an UNKNOWN status counts as ended — the clock must not tick forever', () => {
    expect(isEndedMissionStatus('partial')).toBe(true);
    expect(isEndedMissionStatus('something_new')).toBe(true);
    expect(isEndedMissionStatus(undefined)).toBe(true);
  });
});

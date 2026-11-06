// M7-13c-2b-1: defensive UI — a mission status the UI has not heard of must never crash the
// mission card (`STATUS_CONFIG[status].color` was a TypeError), keep an elapsed clock ticking, or borrow the
// "executing" colour. The components use these pure helpers; vitest here has no JSX transform, so the helpers are the
// testable surface.

import { describe, it, expect } from 'vitest';
import { missionStatusDisplay, isEndedMissionStatus, NEUTRAL_STATUS_COLOR, taskStatusDisplay, missionProgressLabel } from '@/lib/swarm/missionStatusDisplay';

describe('missionStatusDisplay', () => {
  it.each([
    ['pending', '#F97316', 'Pending'], ['planning', '#F97316', 'Planning'], ['ready', '#EAB308', 'Ready'],
    ['executing', '#00F3FF', 'Executing'], ['reviewing', '#A855F7', 'Reviewing'], ['completed', '#10B981', 'Completed'],
    ['failed', '#EF4444', 'Failed'], ['cancelled', '#64748B', 'Cancelled'], ['paused', '#94A3B8', 'Paused'],
    ['partial', '#F59E0B', 'Partial'],
  ])('known status %s keeps exactly the colour and label the card always had', (status, color, label) => {
    expect(missionStatusDisplay(status)).toEqual({ color, label });
  });

  it('an unknown status gets a neutral colour and a humanised label — never undefined, never the "executing" cyan', () => {
    const d = missionStatusDisplay('awaiting_review');
    expect(d).toEqual({ color: NEUTRAL_STATUS_COLOR, label: 'Awaiting review' });
    expect(d.color).not.toBe('#00F3FF');
    // 'partial' is a real status now: its own colour (not the neutral fallback, not the executing cyan)
    expect(missionStatusDisplay('partial').color).not.toBe(NEUTRAL_STATUS_COLOR);
    expect(missionStatusDisplay('partial').color).not.toBe('#00F3FF');
  });

  it.each([[undefined], [null], ['']])('a missing status (%j) is "Unknown" and neutral, not a crash', (s) => {
    expect(missionStatusDisplay(s as never)).toEqual({ color: NEUTRAL_STATUS_COLOR, label: 'Unknown' });
  });
});

describe('isEndedMissionStatus (drives the elapsed clock on the missions list)', () => {
  it.each(['pending', 'planning', 'ready', 'executing', 'reviewing', 'paused'])('%s is still going: the clock runs', (s) => {
    expect(isEndedMissionStatus(s)).toBe(false);
  });
  it.each(['completed', 'failed', 'cancelled', 'partial'])('%s is ended', (s) => {
    expect(isEndedMissionStatus(s)).toBe(true);
  });
  it('an UNKNOWN status counts as ended — the clock must not tick forever', () => {
    expect(isEndedMissionStatus('partial')).toBe(true);
    expect(isEndedMissionStatus('something_new')).toBe(true);
    expect(isEndedMissionStatus(undefined)).toBe(true);
  });
});

describe('taskStatusDisplay', () => {
  it.each([
    ['waiting', '#94A3B8', 'Waiting'], ['ready', '#EAB308', 'Ready'], ['running', '#00F3FF', 'Running'], ['completed', '#10B981', 'Completed'],
    ['failed', '#EF4444', 'Failed'], ['cancelled', '#64748B', 'Cancelled'], ['awaiting_approval', '#A855F7', 'Awaiting approval'],
  ])('known task status %s', (status, color, label) => {
    expect(taskStatusDisplay(status)).toEqual({ color, label });
  });
  it('a skipped task is a real, MUTED "Skipped" state (neither the failure red nor the success green)', () => {
    expect(taskStatusDisplay('skipped')).toEqual({ color: '#64748B', label: 'Skipped' });
  });
  it('keeps the defensive fallback for an unknown task status', () => {
    expect(taskStatusDisplay('something_new')).toEqual({ color: NEUTRAL_STATUS_COLOR, label: 'Something new' });
    expect(taskStatusDisplay(undefined)).toEqual({ color: NEUTRAL_STATUS_COLOR, label: 'Unknown' });
  });
});

describe('missionProgressLabel (replaces the bare "N%" on the mission detail page)', () => {
  const tasks = (...s: string[]) => s.map((status) => ({ status }));
  it('a FAILED mission never shows a bare percentage: "2 of 2 tasks resolved · Failed"', () => {
    const label = missionProgressLabel(tasks('failed', 'failed'), 'failed');
    expect(label).toBe('2 of 2 tasks resolved · Failed');
    expect(label).not.toMatch(/^\d+%$/);
  });
  it('partial / completed / cancelled use the outcome label', () => {
    expect(missionProgressLabel(tasks('completed', 'failed'), 'partial')).toBe('2 of 2 tasks resolved · Partial');
    expect(missionProgressLabel(tasks('completed', 'completed'), 'completed')).toBe('2 of 2 tasks resolved · Completed');
    expect(missionProgressLabel(tasks('cancelled', 'cancelled'), 'cancelled')).toBe('2 of 2 tasks resolved · Cancelled');
  });
  it('a skipped task counts as resolved; open tasks do not; a running mission says "In progress"', () => {
    expect(missionProgressLabel(tasks('completed', 'skipped', 'ready', 'running'), 'executing')).toBe('2 of 4 tasks resolved · In progress');
  });
  it('a paused / pending mission says so instead of "In progress"', () => {
    expect(missionProgressLabel(tasks('completed', 'ready'), 'paused')).toBe('1 of 2 tasks resolved · Paused');
    expect(missionProgressLabel(tasks('ready'), 'pending')).toBe('0 of 1 tasks resolved · Pending');
  });
  it('no tasks yet / unknown status are handled', () => {
    expect(missionProgressLabel([], 'planning')).toBe('No tasks yet');
    expect(missionProgressLabel(tasks('completed'), 'something_new')).toBe('1 of 1 tasks resolved · Something new');
  });
});

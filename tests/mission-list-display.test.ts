// M7-13c-2b-3 (A1, A2, A3): the pure helpers behind the missions list card, the per-tab empty states and the chat ack ordering.

import { describe, it, expect } from 'vitest';
import {
  MISSION_TABS,
  countResolvedTasks,
  missionCardProgress,
  missionMatchesTab,
  missionProgressLabel,
  missionProgressLabelFromCounts,
  missionsEmptyState,
} from '@/lib/swarm/missionStatusDisplay';
import { insertBeforeMessage } from '@/lib/chat/insertBeforeMessage';

describe('A1 — mission card progress for ended missions', () => {
  it.each([
    ['failed', 'Failed'],
    ['partial', 'Partial'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
  ])('a %s mission never shows a bare percentage: it shows the outcome label and the REAL task counts', (status, label) => {
    const p = missionCardProgress({ status, estimatedTasks: 9, counts: { resolved: 2, total: 3 } });
    expect(p.ended).toBe(true);
    expect(p.showPercent).toBe(false);
    expect(p.caption).toBe(`${label} · 2 of 3 tasks resolved`);
  });

  it('a running mission keeps its live progress (percent shown, no caption)', () => {
    for (const status of ['pending', 'planning', 'ready', 'executing', 'reviewing', 'paused']) {
      const p = missionCardProgress({ status, estimatedTasks: 4, counts: { resolved: 1, total: 4 } });
      expect(p).toEqual({ ended: false, showPercent: true, caption: '' });
    }
  });

  it('without real counts the ended card falls back to the planned task count and says so ("~")', () => {
    expect(missionCardProgress({ status: 'failed', estimatedTasks: 5, counts: null }).caption).toBe('Failed · ~5 tasks planned');
    expect(missionCardProgress({ status: 'failed', estimatedTasks: 0, counts: undefined }).caption).toBe('Failed');
  });

  it('a mission that has no task rows at all says so instead of "0 of 0"', () => {
    expect(missionCardProgress({ status: 'failed', estimatedTasks: 3, counts: { resolved: 0, total: 0 } }).caption).toBe('Failed · no tasks were created');
  });

  it('an unrecognised status counts as ended (never an endless running look) and still has no bare percent', () => {
    const p = missionCardProgress({ status: 'some_future_status', estimatedTasks: 2, counts: { resolved: 1, total: 2 } });
    expect(p.showPercent).toBe(false);
    expect(p.caption).toBe('Some future status · 1 of 2 tasks resolved');
  });

  it('counts resolved tasks the same way the detail page does (completed / failed / cancelled / skipped)', () => {
    const tasks = [{ status: 'completed' }, { status: 'failed' }, { status: 'skipped' }, { status: 'cancelled' }, { status: 'ready' }, { status: 'running' }];
    expect(countResolvedTasks(tasks)).toEqual({ resolved: 4, total: 6 });
    expect(missionProgressLabel(tasks, 'executing')).toBe('4 of 6 tasks resolved · In progress');
    expect(missionProgressLabelFromCounts({ resolved: 4, total: 6 }, 'partial')).toBe('4 of 6 tasks resolved · Partial');
  });
});

describe('A2 — per-tab empty states', () => {
  it.each([
    ['Partial', 'No partial missions'],
    ['Failed', 'No failed missions'],
    ['Completed', 'No completed missions'],
    ['Active', 'No active missions'],
    ['Pending', 'No pending missions'],
  ])('the %s tab says "%s"', (tab, title) => {
    expect(missionsEmptyState(tab, { totalMissions: 12 }).title).toBe(title);
    // ...and it says so even when there are no missions at all: the tab name is what the person is looking at.
    expect(missionsEmptyState(tab, { totalMissions: 0 }).title).toBe(title);
  });

  it('All keeps the original "No Active Missions" text, and ONLY when there are truly no missions', () => {
    expect(missionsEmptyState('All', { totalMissions: 0 }).title).toBe('No Active Missions');
    expect(missionsEmptyState('All', { totalMissions: 3 }).title).not.toBe('No Active Missions');
  });

  it('a search with no hit says so, whatever the tab', () => {
    expect(missionsEmptyState('Partial', { totalMissions: 5, query: 'zzz' }).title).toBe('No matching missions');
    expect(missionsEmptyState('All', { totalMissions: 5, query: '  ' }).title).not.toBe('No matching missions');
  });

  it('every tab has its own distinct empty-state title (the helper is never tab-blind)', () => {
    const titles = MISSION_TABS.filter((t) => t !== 'All').map((t) => missionsEmptyState(t, { totalMissions: 4 }).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('tab membership: Partial = partial only; Failed = failed + cancelled; All = everything', () => {
    expect(missionMatchesTab('Partial', 'partial')).toBe(true);
    expect(missionMatchesTab('Partial', 'completed')).toBe(false);
    expect(missionMatchesTab('Failed', 'cancelled')).toBe(true);
    expect(missionMatchesTab('Active', 'paused')).toBe(false);
    expect(missionMatchesTab('Pending', 'paused')).toBe(true);
    expect(missionMatchesTab('All', 'whatever')).toBe(true);
  });
});

describe('A3 — the transient chat ack goes ABOVE the reply placeholder', () => {
  const msg = (id: string) => ({ id });

  it('inserts before the placeholder, so the final reply (which fills the placeholder) is last', () => {
    const list = [msg('u1'), msg('a-reply')];
    expect(insertBeforeMessage(list, 'a-reply', msg('ack1')).map((m) => m.id)).toEqual(['u1', 'ack1', 'a-reply']);
  });

  it('appends when the placeholder is gone (nothing is lost)', () => {
    expect(insertBeforeMessage([msg('u1')], 'missing', msg('ack1')).map((m) => m.id)).toEqual(['u1', 'ack1']);
  });

  it('does not mutate its input', () => {
    const list = [msg('a-reply')];
    insertBeforeMessage(list, 'a-reply', msg('ack1'));
    expect(list.map((m) => m.id)).toEqual(['a-reply']);
  });
});

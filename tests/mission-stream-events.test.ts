// M7-13c-2b-2b: the mission SSE stream must END on 'mission_partial' exactly like mission_completed / mission_failed.
// This is the one item that could hang a client: the stream only closes when it sees a settle event, otherwise it keeps
// polling for the full 5 minutes. Pure helpers + the REAL route handler with the database / auth stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  timeline: [] as Array<Record<string, unknown>>,
  getTimeline: vi.fn(),
}));

vi.mock('@/lib/auth/apiAuth', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
  isTenantMember: vi.fn(async () => true),
}));
vi.mock('@/lib/swarm/missionService', () => ({
  getMission: vi.fn(async () => ({ id: 'm-1', tenantId: 'tenant-1' })),
  getTimeline: h.getTimeline,
}));

import { GET } from '@/app/api/stream/mission/route';
import { SETTLE_TIMELINE_EVENTS, settledOutcomeOf, mapTimelineEventToStreamEvent } from '@/lib/swarm/missionStreamEvents';

const entry = (eventType: string, i: number) => ({ id: `e${i}`, eventType, title: eventType, detail: '', metadata: {}, createdAt: '2026-11-06T12:00:00Z' });

describe('settle events (pure)', () => {
  it('mission_partial is a settle event, next to mission_completed and mission_failed', () => {
    expect([...SETTLE_TIMELINE_EVENTS].sort()).toEqual(['mission_completed', 'mission_failed', 'mission_partial']);
  });
  it('settledOutcomeOf names the outcome, or null while unsettled', () => {
    expect(settledOutcomeOf([entry('task_started', 1)])).toBeNull();
    expect(settledOutcomeOf([entry('task_started', 1), entry('mission_partial', 2)])).toBe('partial');
    expect(settledOutcomeOf([entry('mission_failed', 1)])).toBe('failed');
    expect(settledOutcomeOf([entry('mission_completed', 1)])).toBe('completed');
  });
  it('maps the new timeline events: mission_partial -> mission_partial, task_skipped -> task_finished (existing mappings unchanged)', () => {
    expect(mapTimelineEventToStreamEvent('mission_partial')).toBe('mission_partial');
    expect(mapTimelineEventToStreamEvent('task_skipped')).toBe('task_finished');
    expect(mapTimelineEventToStreamEvent('mission_completed')).toBe('mission_completed');
    expect(mapTimelineEventToStreamEvent('mission_failed')).toBe('mission_failed');
    expect(mapTimelineEventToStreamEvent('something_unknown')).toBe('mission_progress');
  });
});

describe('the route handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.getTimeline.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  /** Reads the stream to its end. Resolves with the full text, or null if it is STILL open after `withinMs` of fake time. */
  async function readAll(withinMs: number): Promise<string | null> {
    const res = await GET(new Request('http://localhost/api/stream/mission?missionId=m-1') as never);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    let finished = false;
    const done = (async () => {
      for (;;) {
        const { done: d, value } = await reader.read();
        if (d) { finished = true; return; }
        text += dec.decode(value);
      }
    })();
    await vi.advanceTimersByTimeAsync(withinMs);
    await Promise.resolve();
    if (!finished) { await reader.cancel().catch(() => {}); return null; }
    await done;
    return text;
  }

  it('ENDS on mission_partial: the closing event carries outcome "partial" and the stream closes (does not poll for 5 minutes)', async () => {
    h.getTimeline.mockResolvedValue([entry('task_started', 1), entry('task_completed', 2), entry('task_failed', 3), entry('mission_partial', 4)]);
    const text = await readAll(5_000);
    expect(text).not.toBeNull();
    expect(text).toContain('event: mission_partial'); // the mapped timeline event itself
    expect(text).toMatch(/"finalEventCount":4/);
    expect(text).toMatch(/"outcome":"partial"/);
    expect(h.getTimeline).toHaveBeenCalledTimes(1);
  });

  it.each([['mission_completed', 'completed'], ['mission_failed', 'failed']])('still ends on %s (outcome %s)', async (event, outcome) => {
    h.getTimeline.mockResolvedValue([entry('task_started', 1), entry(event, 2)]);
    const text = await readAll(5_000);
    expect(text).not.toBeNull();
    expect(text).toContain(`"outcome":"${outcome}"`);
  });

  it('keeps polling while no settle event exists (the stream is still open after several polls)', async () => {
    h.getTimeline.mockResolvedValue([entry('task_started', 1), entry('task_skipped', 2)]);
    const text = await readAll(10_000);
    expect(text).toBeNull();
    expect(h.getTimeline.mock.calls.length).toBeGreaterThan(3);
  });
});

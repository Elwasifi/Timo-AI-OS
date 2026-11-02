// M7-13g: (1) addRuntimeActivity / updateRuntimeState log a failed write instead
// of swallowing it; (2) the send trace prints one labelled line per step with
// elapsed ms, nothing else, and goes quiet after endSendTrace().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const insertResult = vi.hoisted(() => ({ value: { error: null as null | { message: string } } }));
const updateResult = vi.hoisted(() => ({ value: { data: null as unknown, error: null as null | { message: string } } }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) =>
      table === 'runtime_activity'
        ? { insert: async () => insertResult.value }
        : {
            update: () => ({
              eq: () => {
                const q: Record<string, unknown> = {};
                q.eq = () => q;
                q.select = () => ({ maybeSingle: async () => updateResult.value });
                return q;
              },
            }),
          },
  },
}));

import { addRuntimeActivity, updateRuntimeState } from '@/lib/swarm/runtimeStore';
import { startSendTrace, traceStep, endSendTrace } from '@/lib/utils/sendTrace';
import { logger } from '@/lib/utils/logger';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runtimeStore no longer swallows write failures', () => {
  it('a failed runtime_activity insert warns (and still does not throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    insertResult.value = { error: { message: 'JWT expired' } };
    await expect(addRuntimeActivity({ eventType: 'routing', title: 't' })).resolves.toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[2]).includes('runtime_activity insert failed (routing): JWT expired'))).toBe(true);
  });

  it('a successful insert is silent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    insertResult.value = { error: null };
    await addRuntimeActivity({ eventType: 'routing', title: 't' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('updateRuntimeState: a real error warns; the legitimate optimistic-lock miss (no error, no row) stays silent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    updateResult.value = { data: null, error: { message: 'permission denied' } };
    expect(await updateRuntimeState({ executionState: 'routing' })).toBeNull();
    expect(warn.mock.calls.some((c) => String(c[2]).includes('runtime_state update failed: permission denied'))).toBe(true);

    warn.mockClear();
    updateResult.value = { data: null, error: null };
    expect(await updateRuntimeState({ executionState: 'routing' }, 'some-mission')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('sendTrace', () => {
  beforeEach(() => vi.useFakeTimers());

  it('prints one labelled line per step with elapsed ms since start, and nothing after endSendTrace()', () => {
    const lines: string[] = [];
    vi.spyOn(logger, 'system').mockImplementation(((m: string) => { lines.push(m); }) as never);
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    startSendTrace();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.120Z'));
    traceStep('conversation: existing');
    vi.setSystemTime(new Date('2026-01-01T00:00:01.500Z'));
    traceStep('routing begin');
    endSendTrace();
    traceStep('final reply');                    // no active send -> silent

    expect(lines).toEqual([
      '[send] +0ms send() start',
      '[send] +120ms conversation: existing',
      '[send] +1500ms routing begin',
    ]);
  });

  it('traceStep before any send is silent (voice / background work never prints a stale elapsed time)', () => {
    const system = vi.spyOn(logger, 'system').mockImplementation((() => ({})) as never);
    endSendTrace();
    traceStep('routing begin');
    expect(system).not.toHaveBeenCalled();
  });
});

// M7-13g (b): a startConversation() that never resolves must not hold the
// reply beyond the cap, must never create a duplicate conversation, and a start
// that finishes late must still be remembered. Fake timers throughout.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ensureConversationBounded,
  CONVERSATION_START_TIMEOUT_MS,
  __resetEnsureConversationForTesting,
} from '@/lib/chat/ensureConversation';

beforeEach(() => {
  vi.useFakeTimers();
  __resetEnsureConversationForTesting();
});
afterEach(() => vi.useRealTimers());

describe('ensureConversationBounded', () => {
  it('cap is 8 seconds', () => {
    expect(CONVERSATION_START_TIMEOUT_MS).toBe(8_000);
  });

  it('a start that NEVER resolves lets the turn continue after exactly the cap, not before', async () => {
    const startConversation = vi.fn(() => new Promise<string>(() => {}));
    const p = ensureConversationBounded({ getConversationId: () => null, startConversation }, 'Hello');
    let settled = false;
    void p.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(CONVERSATION_START_TIMEOUT_MS - 100);
    expect(settled).toBe(false);                       // still within the cap
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);                        // released at the cap
    expect(await p).toEqual({ status: 'timeout', id: null });
  });

  it('a send while the first start is STILL in flight joins it: exactly one insert, no duplicate conversation', async () => {
    let resolveStart!: (id: string) => void;
    const startConversation = vi.fn(() => new Promise<string>((resolve) => { resolveStart = resolve; }));
    const onStarted = vi.fn();
    const deps = { getConversationId: () => null, startConversation, onStarted };

    const first = ensureConversationBounded(deps, 'one');
    await vi.advanceTimersByTimeAsync(CONVERSATION_START_TIMEOUT_MS + 1);
    expect(await first).toEqual({ status: 'timeout', id: null });

    const second = ensureConversationBounded(deps, 'two');   // user sends again while the insert is still pending
    expect(startConversation).toHaveBeenCalledTimes(1);      // joined, did not start another
    resolveStart('conv-1');
    expect(await second).toEqual({ status: 'started', id: 'conv-1' });
    expect(startConversation).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith('conv-1');
  });

  it('a start that finishes AFTER the turn gave up still runs onStarted (id remembered) and the next turn sees "existing"', async () => {
    let resolveStart!: (id: string) => void;
    let currentId: string | null = null;
    const onStarted = vi.fn();
    const deps = {
      getConversationId: () => currentId,
      startConversation: vi.fn(() => new Promise<string>((resolve) => { resolveStart = (id) => { currentId = id; resolve(id); }; })),
      onStarted,
    };

    const turn1 = ensureConversationBounded(deps, 'x');
    await vi.advanceTimersByTimeAsync(CONVERSATION_START_TIMEOUT_MS + 1);
    expect((await turn1).status).toBe('timeout');
    expect(onStarted).not.toHaveBeenCalled();

    resolveStart('late-conv');                               // the slow insert finally succeeds
    await vi.advanceTimersByTimeAsync(0);
    expect(onStarted).toHaveBeenCalledWith('late-conv');

    expect(await ensureConversationBounded(deps, 'y')).toEqual({ status: 'existing', id: 'late-conv' });
    expect(deps.startConversation).toHaveBeenCalledTimes(1);
  });

  it('an existing conversation is used as-is: no start, no timer', async () => {
    const startConversation = vi.fn();
    const r = await ensureConversationBounded({ getConversationId: () => 'already', startConversation }, 'x');
    expect(r).toEqual({ status: 'existing', id: 'already' });
    expect(startConversation).not.toHaveBeenCalled();
  });

  it('failure paths never throw: "" -> failed, rejection -> failed, and a later turn may try again', async () => {
    const empty = await ensureConversationBounded({ getConversationId: () => null, startConversation: async () => '' }, 'x');
    expect(empty).toEqual({ status: 'failed', id: null });

    const rejecting = await ensureConversationBounded(
      { getConversationId: () => null, startConversation: async () => { throw new Error('insert blew up'); } },
      'x',
    );
    expect(rejecting).toEqual({ status: 'failed', id: null });

    const startConversation = vi.fn(async () => 'retry-ok');
    expect(await ensureConversationBounded({ getConversationId: () => null, startConversation }, 'x')).toEqual({ status: 'started', id: 'retry-ok' });
  });
});

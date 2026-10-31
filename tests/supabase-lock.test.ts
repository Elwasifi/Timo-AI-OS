// M7-13b: reproduces the real Navigator LockManager deadlock that caused
// "every navigation loads forever until a browser refresh" (every Supabase
// REST call goes through SupabaseClient._getAccessToken() -> auth.getSession()
// -> GoTrueClient._acquireLock(-1, ...), and -1 means "no timeout" — a lock
// left held by a dead/orphaned request hangs every future call in the tab
// forever). Exercises the REAL @supabase/auth-js navigatorLock() function
// (not a reimplementation) against a minimal but behaviorally-real Web
// Locks API polyfill — Node has no native navigator.locks — to prove the
// old unbounded call hangs and lib/supabase/client.ts's boundedNavigatorLock
// recovers, without silently breaking GoTrueClient's one legitimate
// acquireTimeout:0 ("fail fast if busy") call site.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

function makeLocksPolyfill() {
  const held = new Set<string>();
  const waiters = new Map<string, Array<{ resolve: () => void }>>();
  return {
    async request(
      name: string,
      optionsOrCallback: unknown,
      maybeCallback?: (lock: { name: string; mode: string } | null) => unknown,
    ) {
      const isFn = typeof optionsOrCallback === 'function';
      const options = (isFn ? {} : optionsOrCallback) as { ifAvailable?: boolean; signal?: AbortSignal };
      const callback = (isFn ? optionsOrCallback : maybeCallback) as (lock: { name: string; mode: string } | null) => unknown;
      const { ifAvailable = false, signal } = options;

      if (held.has(name)) {
        if (ifAvailable) return callback(null);
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            const list = waiters.get(name) ?? [];
            waiters.set(name, list.filter((w) => w.resolve !== resolve));
            const e = new Error('The request was aborted.');
            e.name = 'AbortError';
            reject(e);
          };
          if (signal) {
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort);
          }
          const list = waiters.get(name) ?? [];
          list.push({ resolve: () => { signal?.removeEventListener('abort', onAbort); resolve(); } });
          waiters.set(name, list);
        });
      }
      held.add(name);
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        held.delete(name);
        const next = (waiters.get(name) ?? []).shift();
        if (next) next.resolve();
      }
    },
  };
}

/** Starts a zombie holder for `key` that holds the lock until `release()` is called — needed to test that a stuck-state reset happens once the lock genuinely becomes available again. */
function holdLockUntilReleased(key: string, acquireFn: typeof import('@supabase/supabase-js').navigatorLock): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  void acquireFn(key, -1, () => held).catch(() => {});
  return () => release();
}

let navigatorLock: typeof import('@supabase/supabase-js').navigatorLock;
let boundedNavigatorLock: typeof import('@/lib/supabase/client').boundedNavigatorLock;
let __setStuckCooldownMsForTesting: typeof import('@/lib/supabase/client').__setStuckCooldownMsForTesting;
let __setLockAcquireTimeoutMsForTesting: typeof import('@/lib/supabase/client').__setLockAcquireTimeoutMsForTesting;

// Production defaults — restored after every test in the cooldown
// describe block below so shrinking them for one test can't leak into
// the next (including the earlier describe block's own tests, which
// rely on the real 5s LOCK_ACQUIRE_TIMEOUT_MS to assert "< 6000ms").
const PROD_STUCK_COOLDOWN_MS = 60_000;
const PROD_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

beforeAll(async () => {
  // Node 22+ ships a partial, read-only global `navigator` — override just
  // `.locks` on it rather than replacing the whole object.
  Object.defineProperty(globalThis.navigator, 'locks', { value: makeLocksPolyfill(), configurable: true });
  ({ navigatorLock } = await import('@supabase/supabase-js'));
  ({ boundedNavigatorLock, __setStuckCooldownMsForTesting, __setLockAcquireTimeoutMsForTesting } = await import('@/lib/supabase/client'));
});

describe('boundedNavigatorLock (M7-13b lock-deadlock fix)', () => {
  it('OLD behavior: raw navigatorLock with acquireTimeout -1 hangs forever behind a stuck lock', async () => {
    const key = `lock:test-${Math.random()}`;
    void navigatorLock(key, -1, () => new Promise(() => {})).catch(() => {}); // zombie holder, never resolves
    await new Promise((r) => setTimeout(r, 50)); // let it actually acquire first

    let resolved = false;
    void navigatorLock(key, -1, async () => 'unreachable').then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 1000));
    expect(resolved).toBe(false); // proves the real SDK call would hang indefinitely
  });

  it('NEW behavior: recovers within the bounded timeout instead of hanging', async () => {
    const key = `lock:test-${Math.random()}`;
    void navigatorLock(key, -1, () => new Promise(() => {})).catch(() => {}); // zombie holder
    await new Promise((r) => setTimeout(r, 50));

    const start = Date.now();
    const result = await boundedNavigatorLock(key, -1, async () => 'ran-without-lock');
    const elapsed = Date.now() - start;

    expect(result).toBe('ran-without-lock');
    expect(elapsed).toBeLessThan(6_000); // LOCK_ACQUIRE_TIMEOUT_MS (5s) + slack, not "forever"
  });

  it('happy path: lock free — behaves identically to plain navigatorLock, no artificial delay', async () => {
    const key = `lock:test-${Math.random()}`;
    const start = Date.now();
    const result = await boundedNavigatorLock(key, -1, async () => 'acquired-normally');
    expect(result).toBe('acquired-normally');
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('acquireTimeout=0 (GoTrueClient._autoRefreshTokenTick\'s fail-fast guard) is NOT widened and NOT bypassed', async () => {
    const key = `lock:test-${Math.random()}`;
    void navigatorLock(key, -1, () => new Promise(() => {})).catch(() => {}); // zombie holder
    await new Promise((r) => setTimeout(r, 50));

    // Must reject immediately (not wait ~5s) and must NOT silently run fn()
    // without the lock — that would let two auto-refresh ticks run
    // concurrently, defeating the lock's actual correctness purpose there.
    const start = Date.now();
    await expect(boundedNavigatorLock(key, 0, async () => 'must-not-run')).rejects.toMatchObject({
      isAcquireTimeout: true,
    });
    expect(Date.now() - start).toBeLessThan(200);
  });
});

// M7-13b review follow-up: the first version waited the full
// LOCK_ACQUIRE_TIMEOUT_MS (5s) on EVERY call once a lock was known stuck —
// a permanent hang became a permanent +5s tax on every subsequent request.
// These tests shrink both LOCK_ACQUIRE_TIMEOUT_MS and STUCK_COOLDOWN_MS via
// the test-only setters so the cooldown window can actually be exercised
// (including letting it expire) without the suite taking minutes.
describe('boundedNavigatorLock — stuck-lock cooldown (does not re-wait on every call)', () => {
  afterEach(() => {
    __setLockAcquireTimeoutMsForTesting(PROD_LOCK_ACQUIRE_TIMEOUT_MS);
    __setStuckCooldownMsForTesting(PROD_STUCK_COOLDOWN_MS);
  });

  it('a second call for the same stuck name resolves fast instead of waiting out the timeout again', async () => {
    __setLockAcquireTimeoutMsForTesting(150);
    __setStuckCooldownMsForTesting(60_000); // long enough that this test can't accidentally outlast it

    const key = `lock:test-${Math.random()}`;
    void navigatorLock(key, -1, () => new Promise(() => {})).catch(() => {}); // zombie holder
    await new Promise((r) => setTimeout(r, 50));

    // First call: genuinely pays the (now-shrunk) wait and logs the warning.
    const firstStart = Date.now();
    const first = await boundedNavigatorLock(key, -1, async () => 'first');
    expect(first).toBe('first');
    expect(Date.now() - firstStart).toBeGreaterThanOrEqual(140); // actually waited ~150ms, didn't skip

    // Second call for the SAME name, still within the cooldown — must NOT
    // wait again (this is the actual bug being fixed: previously this
    // would have taken another ~150ms-in-this-test / 5s-in-production).
    const secondStart = Date.now();
    const second = await boundedNavigatorLock(key, -1, async () => 'second');
    const secondElapsed = Date.now() - secondStart;
    expect(second).toBe('second');
    expect(secondElapsed).toBeLessThan(500);
  });

  it('resets once the cooldown window elapses, even if the lock is still held', async () => {
    __setLockAcquireTimeoutMsForTesting(100);
    __setStuckCooldownMsForTesting(200);

    const key = `lock:test-${Math.random()}`;
    void navigatorLock(key, -1, () => new Promise(() => {})).catch(() => {}); // zombie, never released
    await new Promise((r) => setTimeout(r, 30));

    await boundedNavigatorLock(key, -1, async () => 'first'); // establishes the stuck state

    // Still within cooldown — fast bypass, no real wait.
    const withinStart = Date.now();
    await boundedNavigatorLock(key, -1, async () => 'within-cooldown');
    expect(Date.now() - withinStart).toBeLessThan(80);

    // Let the (shrunk) cooldown fully elapse.
    await new Promise((r) => setTimeout(r, 250));

    // Lock is STILL held by the zombie, so this call genuinely re-attempts
    // acquisition and pays the (shrunk) timeout again — proving the
    // cooldown actually expired rather than being stuck "stuck" forever.
    const afterCooldownStart = Date.now();
    await boundedNavigatorLock(key, -1, async () => 'after-cooldown');
    expect(Date.now() - afterCooldownStart).toBeGreaterThanOrEqual(90);
  });

  it('resets immediately once a normal acquisition succeeds, without waiting for the cooldown to expire', async () => {
    __setLockAcquireTimeoutMsForTesting(150);
    __setStuckCooldownMsForTesting(60_000); // deliberately long — proves the reset is NOT just "cooldown happened to expire"

    const key = `lock:test-${Math.random()}`;
    const release = holdLockUntilReleased(key, navigatorLock);
    await new Promise((r) => setTimeout(r, 30));

    await boundedNavigatorLock(key, -1, async () => 'first'); // times out, marks stuck, bypasses

    // Free the lock for real, then immediately let it be acquired normally
    // (not via the bypass path) so the stuck state should clear.
    release();
    await new Promise((r) => setTimeout(r, 30));
    const reacquired = await boundedNavigatorLock(key, -1, async () => 'reacquired-normally');
    expect(reacquired).toBe('reacquired-normally');

    // Make the lock busy again with a brand new zombie. If the stuck state
    // had NOT been cleared by the successful acquisition above, this call
    // would still be "within cooldown" (60s, set above) and bypass
    // instantly. Instead it should pay a REAL wait again, proving the
    // reset actually happened rather than coincidentally expiring.
    void navigatorLock(key, -1, () => new Promise(() => {})).catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    const start = Date.now();
    await boundedNavigatorLock(key, -1, async () => 'third');
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });
});

// Review follow-up: boundedNavigatorLock could not previously tell "the
// lock was never acquired" from "the lock WAS acquired and fn() itself
// rejected" — both the cooldown probe's .catch(() => fn()) and the main
// path's AbortError check treated any rejection the same way, which meant
// a real fn() failure (e.g. a token-refresh fetch that got aborted, or
// any other genuine error) got silently re-run a second time, and in the
// main path's case also incorrectly marked the lock "stuck" for 60s even
// though the lock itself was never the problem. Fixed with a `started`
// flag that's only set once navigatorLock actually invokes the callback
// (i.e. the lock really was acquired) — these tests assert fn() is called
// exactly once via a vi.fn() spy, not just that the function eventually
// resolves/rejects, since a double-execution bug can look identical from
// the outside if fn() is idempotent (it usually won't be — a real token
// refresh or a real DB write is not idempotent).
describe('boundedNavigatorLock — distinguishes "lock not acquired" from "fn() itself failed" (no double-execution)', () => {
  afterEach(() => {
    __setLockAcquireTimeoutMsForTesting(PROD_LOCK_ACQUIRE_TIMEOUT_MS);
    __setStuckCooldownMsForTesting(PROD_STUCK_COOLDOWN_MS);
  });

  it('(a) lock free, fn rejects with a generic Error -> rejected once, fn called exactly 1 time, lock NOT marked stuck', async () => {
    const key = `lock:test-${Math.random()}`;
    const fn = vi.fn(async () => { throw new Error('a real application error, unrelated to locking'); });

    await expect(boundedNavigatorLock(key, -1, fn)).rejects.toThrow('a real application error, unrelated to locking');
    expect(fn).toHaveBeenCalledTimes(1);

    // Not marked stuck: a subsequent call on the SAME name with a
    // succeeding fn must acquire normally (not bypass), proving no
    // stuck-cooldown entry was created by the fn()-level failure above.
    // If it had been incorrectly marked stuck, this would still succeed
    // (bypass just runs fn() directly) but WITHOUT ever really exercising
    // the lock — the real signal here is the warn-call count below.
    const warnSpy = vi.spyOn(console, 'warn');
    warnSpy.mockClear();
    const result = await boundedNavigatorLock(key, -1, async () => 'clean-call');
    expect(result).toBe('clean-call');
    expect(warnSpy).not.toHaveBeenCalled(); // no "could not be acquired" warning — it was never stuck
    warnSpy.mockRestore();
  });

  it('(b) lock free, fn rejects with a DOMException named AbortError (simulating an aborted fetch) -> rethrown, fn called exactly 1 time, NOT marked stuck, no stuck-lock warning', async () => {
    const key = `lock:test-${Math.random()}`;
    const abortLikeError = new Error('The user aborted a request.');
    abortLikeError.name = 'AbortError'; // exactly what a real aborted fetch throws — this is the actual bug scenario
    const fn = vi.fn(async () => { throw abortLikeError; });

    const warnSpy = vi.spyOn(console, 'warn');
    warnSpy.mockClear();

    await expect(boundedNavigatorLock(key, -1, fn)).rejects.toBe(abortLikeError);
    expect(fn).toHaveBeenCalledTimes(1); // the actual bug: this used to be 2 (misread as a lock timeout, re-ran fn())
    expect(warnSpy).not.toHaveBeenCalled(); // must NOT log "could not be acquired" — this was never a lock problem

    warnSpy.mockRestore();
  });

  it('(c) during cooldown with the lock actually free, fn rejects -> rethrown, fn called exactly 1 time', async () => {
    __setLockAcquireTimeoutMsForTesting(100);
    __setStuckCooldownMsForTesting(60_000); // long cooldown so the NEXT call definitely takes the probe path, not a fresh real wait

    const key = `lock:test-${Math.random()}`;
    const release = holdLockUntilReleased(key, navigatorLock);
    await new Promise((r) => setTimeout(r, 30));

    // Establish the stuck state for real: a genuine timeout, lock never
    // acquired by this call.
    await boundedNavigatorLock(key, -1, async () => 'first');

    // Free the lock for real. The NEXT call is still within the (long)
    // cooldown, so it takes the probe path — and since the lock is
    // genuinely free now, the probe WILL acquire it for real this time.
    release();
    await new Promise((r) => setTimeout(r, 30));

    const fn = vi.fn(async () => { throw new Error('fn failed after a successful probe acquisition'); });
    await expect(boundedNavigatorLock(key, -1, fn)).rejects.toThrow('fn failed after a successful probe acquisition');
    expect(fn).toHaveBeenCalledTimes(1); // the actual bug: probe's .catch(() => fn()) used to re-run this a 2nd time
  });
});

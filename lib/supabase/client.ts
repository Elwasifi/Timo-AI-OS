import { createClient, navigatorLock } from '@supabase/supabase-js';
import { timeoutFetch } from './timeoutFetch';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing env vars — client will not function');
}

// M7-13b: @supabase/auth-js's getSession() — which EVERY REST query this
// client makes goes through, via SupabaseClient._getAccessToken()
// (node_modules/@supabase/supabase-js/dist/main/SupabaseClient.js) —
// acquires a browser-wide `navigator.locks` exclusive lock with
// acquireTimeout: -1 ("no timeout", confirmed: every GoTrueClient call
// site except signOut's acquireTimeout: 0) before doing anything. If that
// lock is ever left held — an HMR reload orphaning an in-flight request,
// two tabs contending, a hung token-refresh network call under
// autoRefreshToken: true — the `await` inside auth-js's _acquireLock()
// never resolves, so EVERY subsequent Supabase call in the tab hangs
// forever with no way to recover short of a hard page reload (confirmed
// live: this exactly matches the "every navigation loads forever until a
// refresh" symptom, M7-13b diagnostic). There is no timeout option on
// GoTrueClient itself for this — the only way to bound it is to supply a
// custom `lock` function.
//
// This wraps the SDK's own real `navigatorLock` (not a reimplementation —
// same locking behavior, same debug logging via the
// `supabase.gotrue-js.locks.debug` localStorage flag) but overrides its
// effective timeout: signOut's intentional immediate-fail case
// (acquireTimeout === 0) passes through unchanged, everything else
// (today, only the -1/"wait forever" case) is capped at
// LOCK_ACQUIRE_TIMEOUT_MS. On a real timeout, this proceeds WITHOUT the
// lock instead of re-throwing — i.e. it steals/bypasses it — logging a
// single console.warn so a stuck lock is visible instead of silent.
//
// Trade-off, explicit: bypassing the lock on timeout means two concurrent
// session-refresh operations (e.g. this tab mid-refresh while another tab
// also refreshes) could theoretically race and each write a slightly
// different session to localStorage — a rare, self-correcting edge case
// (the next request just re-reads whichever session won) — versus the
// current behavior, where ANY stuck lock permanently wedges every future
// Supabase call in the tab until a hard reload. Given this app's real,
// confirmed symptom is the permanent-hang case, not the race case,
// bounded-with-bypass is the safer default here.
let LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

/** Test-only escape hatch — see __setStuckCooldownMsForTesting's comment below for why this needs a setter rather than direct reassignment. Shrinks the wait so cooldown-path tests don't each have to really sit through a 5s timeout. */
export function __setLockAcquireTimeoutMsForTesting(ms: number): void {
  LOCK_ACQUIRE_TIMEOUT_MS = ms;
}

// M7-13b review follow-up: the first version waited the full
// LOCK_ACQUIRE_TIMEOUT_MS on EVERY call once a lock was stuck — a
// permanent hang became a permanent +5s tax on every single subsequent
// Supabase request in the tab, which is still a real usability problem
// even though it's no longer an infinite one. Once a lock name has
// genuinely timed out, that's remembered for STUCK_COOLDOWN_MS: further
// calls for that same name skip waiting entirely (call fn() directly,
// no lock attempt at all) until either the cooldown elapses or a normal
// acquisition succeeds again (the success path below clears the entry).
let STUCK_COOLDOWN_MS = 60_000;
const stuckUntilByName = new Map<string, number>();

/**
 * Test-only escape hatch (tests/supabase-lock.test.ts) — an imported
 * `let` binding can't be reassigned from outside its own module (ESM
 * live bindings are read-only views to consumers), so the cooldown
 * duration needs an explicit setter to be shrinkable for a test that
 * can't afford to really wait out a 60s cooldown. Not meant to be
 * called from application code; production always uses the real 60s.
 */
export function __setStuckCooldownMsForTesting(ms: number): void {
  STUCK_COOLDOWN_MS = ms;
}

/** Exported for tests/supabase-lock.test.ts — not meant to be imported elsewhere. */
export function boundedNavigatorLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  // acquireTimeout === 0 is itself a deliberate "fail immediately if busy,
  // don't wait at all" call (confirmed: the one real call site is
  // _autoRefreshTokenTick()'s own lock guard — it's designed to skip this
  // refresh tick and retry on the next one if another operation already
  // holds the lock, NOT to run the tick concurrently without the lock).
  // That correctness property matters — bypassing the lock there would
  // mean two token-refresh ticks could run at once, exactly what the lock
  // exists to prevent. So acquireTimeout === 0 is passed through verbatim,
  // including re-throwing its rejection unchanged, and never consults or
  // touches the stuck-cooldown state below — only the cases WE widen
  // (today, just the -1/"wait forever" case) get the cooldown/bypass
  // treatment.
  const weImposedTheTimeout = acquireTimeout !== 0;

  if (weImposedTheTimeout) {
    const stuckUntil = stuckUntilByName.get(name);
    if (stuckUntil !== undefined && Date.now() < stuckUntil) {
      // Known-stuck within the cooldown window — never pay the full wait
      // again, but still worth a single non-blocking probe (acquireTimeout
      // 0, the SDK's own "ifAvailable" mode — resolves or rejects
      // immediately, no waiting either way) in case the original holder
      // has actually released it since. This is what lets state reset
      // "until a normal acquisition succeeds again", not just after the
      // cooldown elapses — an earlier version of this bypassed
      // unconditionally during the cooldown, which meant a lock that
      // freed up mid-cooldown would never be noticed until the cooldown
      // ran out anyway (caught by this function's own test suite).
      //
      // Review follow-up bug: navigatorLock(name, 0, fn).catch(() => fn())
      // can't tell "the probe never acquired the lock" from "the probe
      // DID acquire it and fn() itself then rejected" (e.g. a real
      // network error during a token refresh) — the old code re-ran fn()
      // in BOTH cases, meaning a real failure got silently retried/
      // double-executed. `started` disambiguates: it's only flipped true
      // once navigatorLock actually invokes the callback (i.e. the lock
      // really was acquired), so a rejection with started===false means
      // "still busy, never got the lock" (safe to bypass — run fn()
      // exactly once, for real) and started===true means "fn ran and
      // failed on its own merits" (rethrow untouched, never re-run it).
      let started = false;
      const guardedProbe = () => { started = true; return fn(); };
      return navigatorLock(name, 0, guardedProbe)
        .then((result) => {
          stuckUntilByName.delete(name);
          return result;
        })
        .catch((err: unknown) => {
          if (started) throw err;
          return fn();
        });
    }
  }

  const effectiveTimeout = weImposedTheTimeout ? LOCK_ACQUIRE_TIMEOUT_MS : 0;
  // Same started-flag disambiguation as the cooldown-probe path above,
  // and for the same reason: `err.name === 'AbortError'` below is how a
  // genuine lock-acquire timeout presents (confirmed empirically), but
  // it's ALSO exactly what a real aborted fetch inside fn() itself throws
  // — e.g. a token-refresh request that got cancelled. Without this
  // check, that real fn() failure would be misread as "the lock timed
  // out", mark the lock stuck for STUCK_COOLDOWN_MS, and re-run fn() a
  // second time — silently double-executing whatever fn() does.
  let started = false;
  const guarded = () => { started = true; return fn(); };
  return navigatorLock(name, effectiveTimeout, guarded)
    .then((result) => {
      // A normal acquisition succeeded — if this name was previously
      // marked stuck (e.g. the holder finally released it, or this call
      // landed after the cooldown expired and got lucky), clear it
      // immediately rather than waiting out the rest of the cooldown.
      if (weImposedTheTimeout) stuckUntilByName.delete(name);
      return result;
    })
    .catch((err: unknown) => {
      // fn() actually ran (we held the real lock) and failed on its own
      // merits — not a lock-acquisition problem at all. Never touch the
      // stuck-cooldown state and never re-run it.
      if (started) throw err;

      if (!weImposedTheTimeout) throw err;
      // Empirically verified (tests/supabase-lock.test.ts, a real Web
      // Locks API polyfill exercising the actual @supabase/auth-js
      // navigatorLock()): a genuine timeout — effectiveTimeout elapses
      // while waiting, the internal AbortController fires — rejects with
      // a PLAIN DOMException named 'AbortError', NOT an object with
      // isAcquireTimeout:true. That flag is only ever set by auth-js's
      // own NavigatorLockAcquireTimeoutError, thrown in the
      // acquireTimeout===0 branch we've already excluded above. Checking
      // isAcquireTimeout alone would silently miss the real timeout case
      // this function exists to handle — checked both deliberately.
      const isTimeoutLike =
        !!(err && typeof err === 'object' && 'isAcquireTimeout' in err && (err as { isAcquireTimeout?: boolean }).isAcquireTimeout) ||
        (err instanceof Error && err.name === 'AbortError');
      if (!isTimeoutLike) throw err;

      const alreadyStuck = stuckUntilByName.has(name);
      stuckUntilByName.set(name, Date.now() + STUCK_COOLDOWN_MS);
      if (!alreadyStuck) {
        console.warn(
          `[supabase] Lock "${name}" could not be acquired within ${effectiveTimeout}ms (likely held by a stuck tab/request) — proceeding without it for the next ${STUCK_COOLDOWN_MS}ms rather than hanging or re-waiting on every call.`,
        );
      }
      return fn(); // first real execution — started was false, this is the only call
    });
}

// V1: RLS is now authenticated-only (see supabase/migrations/20260819140000_*).
//
// In the browser, this client carries the signed-in user's session (set by
// authStore), so every existing service file (missionService,
// agentRegistryService, memoryStore, ...) keeps working unchanged — the
// call is scoped by RLS to that user's tenant(s) automatically.
//
// Server-side (Next.js API routes, the task-queue processor), there is no
// browser session to carry. Using the anon key there would make every one
// of those same service files fail under RLS (no authenticated role). To
// avoid a broad refactor of every DB-calling function to accept an
// injectable client, this single module is context-aware instead: when
// executed server-side AND SUPABASE_SERVICE_ROLE_KEY is configured, it
// uses the service-role key (bypasses RLS, same trust level Edge Functions
// already run at). SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix,
// so Next.js never inlines its value into the browser bundle — the
// `typeof window === 'undefined'` branch is genuinely unreachable client-side.
//
// IMPORTANT: because server-side code now runs with full service-role
// trust, every API route that uses this client for tenant-scoped data
// MUST perform its own authorization check (see lib/auth/apiAuth.ts) —
// RLS is no longer the backstop there.
const isServer = typeof window === 'undefined';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase =
  isServer && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: timeoutFetch },
      })
    : createClient(supabaseUrl, supabaseAnonKey, {
        // boundedNavigatorLock only matters in the browser (navigator.locks
        // doesn't exist in Node) — the server branch above never reaches
        // here, and even the no-service-role server fallback (anon key,
        // no session to lock around) is harmless to apply it to.
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, lock: boundedNavigatorLock },
        // M7-13e: every auth/REST/functions request gets a ceiling (see timeoutFetch.ts).
        global: { fetch: timeoutFetch },
      });

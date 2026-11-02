// M7-13g: the shared client must only be given the custom bounded lock where the
// Web Locks API exists. Without it (Node < 24.5, i.e. v22), the SDK's
// navigatorLock dereferences `navigator.locks.request` and throws a TypeError
// inside GoTrueClient's own initialize(), which surfaced as unhandled
// rejections ("Cannot read properties of undefined (reading 'request')") for any
// consumer that imports the client without SUPABASE_SERVICE_ROLE_KEY — tests,
// scripts, a misconfigured server. The client module is re-evaluated per test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type ClientModule = typeof import('@/lib/supabase/client');
const lockOf = (m: ClientModule) => (m.supabase.auth as unknown as { lock: unknown }).lock;

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

async function loadClient(): Promise<ClientModule> {
  vi.resetModules();
  return import('@/lib/supabase/client');
}

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  // Anon-key branch (no service-role key), dummy project: no network is ever contacted.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://dummy.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'dummy-anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('shared client — bounded lock is only installed where Web Locks exist', () => {
  it('WITHOUT navigator.locks: no "reading \'request\'" rejection, and the lock is NOT boundedNavigatorLock', async () => {
    vi.stubGlobal('navigator', {});                       // the Node < 24.5 shape: a navigator with no .locks
    const m = await loadClient();
    await new Promise((resolve) => setTimeout(resolve, 100));   // real macrotasks: let auth-js initialize() run and any rejection surface

    expect(lockOf(m)).not.toBe(m.boundedNavigatorLock);   // auth-js default (lockNoOp outside a browser) applies
    expect(unhandled).toEqual([]);
  });

  it('with no navigator at all (plain non-browser runtime): same — no rejection, default lock', async () => {
    vi.stubGlobal('navigator', undefined);
    const m = await loadClient();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lockOf(m)).not.toBe(m.boundedNavigatorLock);
    expect(unhandled).toEqual([]);
  });

  it('WITH navigator.locks: the client still uses boundedNavigatorLock', async () => {
    // Minimal Web Locks stand-in so the result does not depend on the Node version running the tests.
    vi.stubGlobal('navigator', {
      locks: { request: async (_name: string, _opts: unknown, callback: (lock: unknown) => unknown) => callback({}) },
    });
    const m = await loadClient();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lockOf(m)).toBe(m.boundedNavigatorLock);
    expect(unhandled).toEqual([]);
  });
});

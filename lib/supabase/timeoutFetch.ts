// M7-13e: a stalled network request must never leave the UI on "THINKING"
// forever. supabase-js passes `global.fetch` to its auth, REST, functions and
// storage clients, so one wrapper here bounds every call the app makes
// through the shared client. Each request gets a ceiling by kind; if the
// caller already supplied an AbortSignal, either one aborting wins.
//
// Failure is loud and typed (SupabaseTimeoutError) rather than a silent
// never-resolving promise.

export const AUTH_TIMEOUT_MS = 10_000;
export const REST_TIMEOUT_MS = 15_000;
/** Edge functions (storage, other functions) — chat provider calls use their own per-provider timeout in lib/ai/ai-provider.ts. */
export const FUNCTIONS_TIMEOUT_MS = 20_000;
/** Realtime / storage / anything unclassified. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export class SupabaseTimeoutError extends Error {
  readonly code = 'timeout';
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'SupabaseTimeoutError';
  }
}

export function timeoutForUrl(url: string): number {
  if (url.includes('/auth/v1/')) return AUTH_TIMEOUT_MS;
  if (url.includes('/rest/v1/')) return REST_TIMEOUT_MS;
  if (url.includes('/functions/v1/')) return FUNCTIONS_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Builds a fetch that aborts after a URL-dependent ceiling. `baseFetch` is
 * injectable for tests; production uses the global fetch resolved at call
 * time (so test/harness monkey-patching of globalThis.fetch still applies).
 */
export function createTimeoutFetch(baseFetch?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    const timeoutMs = timeoutForUrl(url);
    const controller = new AbortController();
    let timedOut = false;
    let rejectTimeout: (e: SupabaseTimeoutError) => void = () => {};
    // Raced against the request itself so the error is typed and prompt even
    // if a fetch implementation ignores the AbortSignal.
    const timeoutRace = new Promise<never>((_, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectTimeout(new SupabaseTimeoutError(url, timeoutMs));
    }, timeoutMs);

    const upstream = init?.signal ?? (typeof input === 'object' && 'signal' in input ? (input as Request).signal : undefined);
    const onUpstreamAbort = () => controller.abort();
    if (upstream) {
      if (upstream.aborted) controller.abort();
      else upstream.addEventListener('abort', onUpstreamAbort, { once: true });
    }

    try {
      const f = baseFetch ?? globalThis.fetch;
      return await Promise.race([f(input, { ...init, signal: controller.signal }), timeoutRace]);
    } catch (err) {
      if (timedOut) throw new SupabaseTimeoutError(url, timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', onUpstreamAbort);
    }
  };
}

export const timeoutFetch: typeof fetch = createTimeoutFetch();

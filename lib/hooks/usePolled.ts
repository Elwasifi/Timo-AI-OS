'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefetch, type RealtimeTableWatch } from './useRealtimeRefetch';

// M4-06: every "live" widget used to fetch exactly once on mount with no
// revalidation — the confirmed cause of "needs a manual refresh every
// minute for things to work" (Operational Integrity Audit, section 7).
// Originally added inline in command-widgets.tsx; extracted here (M6-05)
// once org-chart.tsx needed the identical polling behavior rather than a
// second copy of the same hook.
const DEFAULT_POLL_MS = 15_000;

// M7-12: when a caller supplies realtimeTables, polling becomes a safety
// net (same philosophy as M7-02's mission detail/G-Brain panels — a
// Realtime subscription is the primary trigger, a slow poll covers a
// dropped connection) rather than the sole refresh mechanism, so the
// interval widens unless the caller explicitly overrides it.
const SAFETY_NET_POLL_MS = 60_000;

/**
 * @param fetcher The data-fetching function (unchanged contract).
 * @param intervalMs Explicit poll interval override. Omit to get
 *   DEFAULT_POLL_MS (no realtimeTables) or SAFETY_NET_POLL_MS (with
 *   realtimeTables) automatically.
 * @param realtimeTables M7-12: Postgres Changes watches (useRealtimeRefetch)
 *   that trigger an immediate refetch on top of the interval. Omit to keep
 *   the original pure-polling behavior unchanged.
 */
export function usePolled<T>(
  fetcher: () => Promise<T>,
  intervalMs?: number,
  realtimeTables?: RealtimeTableWatch[],
): T | null {
  const [data, setData] = useState<T | null>(null);
  const effectiveInterval = intervalMs ?? (realtimeTables && realtimeTables.length > 0 ? SAFETY_NET_POLL_MS : DEFAULT_POLL_MS);

  const load = useCallback(() => {
    let cancelled = false;
    fetcher().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => { cancelled = true; };
  }, [fetcher]);

  useEffect(() => {
    let cancelCurrent = load();
    const t = setInterval(() => {
      cancelCurrent();
      cancelCurrent = load();
    }, effectiveInterval);
    return () => {
      clearInterval(t);
      cancelCurrent();
    };
  }, [load, effectiveInterval]);

  useRealtimeRefetch(realtimeTables ?? [], load);

  return data;
}

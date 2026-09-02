'use client';

import { useEffect, useState } from 'react';

// M4-06: every "live" widget used to fetch exactly once on mount with no
// revalidation — the confirmed cause of "needs a manual refresh every
// minute for things to work" (Operational Integrity Audit, section 7).
// Originally added inline in command-widgets.tsx; extracted here (M6-05)
// once org-chart.tsx needed the identical polling behavior rather than a
// second copy of the same hook.
const DEFAULT_POLL_MS = 15_000;

export function usePolled<T>(fetcher: () => Promise<T>, intervalMs = DEFAULT_POLL_MS): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetcher().then((d) => {
        if (!cancelled) setData(d);
      });
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [fetcher, intervalMs]);
  return data;
}

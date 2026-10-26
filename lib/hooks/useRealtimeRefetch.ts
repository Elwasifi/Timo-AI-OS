'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface RealtimeTableWatch {
  table: string;
  // Postgres Changes filter, e.g. `id=eq.${missionId}`. Omit to watch every
  // row on the table (still scoped server-side by that table's own RLS
  // policies for the subscribing user — never raw/unfiltered access).
  filter?: string;
}

// M7-02: several panels (G-Brain's active-mission indicator, the mission
// detail page's Objectives/Timeline/Tasks) polled on a fixed interval
// regardless of whether anything had actually changed. Replaces that with
// a real Supabase Realtime subscription (Postgres Changes) on the
// underlying tables — the caller's existing fetch/refetch function still
// does the actual read (joins, transforms, RLS), this hook only decides
// *when* to call it. Multiple changes arriving in a burst (e.g. several
// mission_tasks rows updating within the same tick) are coalesced into one
// refetch via a short debounce rather than one refetch per row event.
//
// `watches` is intentionally safe to pass as a fresh array literal on
// every render — the subscribe/unsubscribe effect below depends on
// `watchKey`, a string derived from `watches`' *contents*, not on the
// array's identity. A new literal with the same table/filter values
// produces the same watchKey and does not tear down or recreate the
// channel. Callers should NOT wrap `watches` in `useMemo` — that just
// adds a layer of indirection around a guarantee this hook already
// provides (confirmed M7-12: command-widgets.tsx's 8 call sites and
// missions/page.tsx all pass inline literals with no resubscribe churn).
export function useRealtimeRefetch(watches: RealtimeTableWatch[], onChange: () => void, debounceMs = 300): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const watchKey = watches.map((w) => `${w.table}:${w.filter ?? '*'}`).join('|');

  useEffect(() => {
    if (watches.length === 0) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => onChangeRef.current(), debounceMs);
    };

    let channel = supabase.channel(`realtime:${watchKey}`);
    for (const w of watches) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: w.table, ...(w.filter ? { filter: w.filter } : {}) },
        trigger,
      );
    }
    channel.subscribe();

    return () => {
      if (timeout) clearTimeout(timeout);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, debounceMs]);
}

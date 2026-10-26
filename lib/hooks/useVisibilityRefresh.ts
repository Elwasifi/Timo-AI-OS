'use client';

import { useEffect, useRef } from 'react';

/**
 * M7-13: the diagnostic round confirmed Chrome throttles setInterval-based
 * timers in backgrounded/idle tabs — both Realtime's own heartbeat
 * (@supabase/realtime-js's RealtimeClient uses a plain setInterval) and
 * this app's usePolled safety-net poll, so both degrade together while a
 * tab is hidden. A grep across this entire codebase at diagnosis time
 * found zero visibilitychange/focus-based recovery anywhere — a tab
 * regaining focus never triggered a fresh fetch or reconnect, leaving
 * stale data on screen until a manual reload.
 *
 * Centralized here instead of duplicated per hook/page, per the ticket's
 * explicit instruction — useRealtimeRefetch and usePolled both consume
 * this one listener rather than each registering their own.
 *
 * Both visibilitychange (tab switch) and window focus (e.g. alt-tabbing
 * back, or switching from another app on the same visible tab) are
 * listened for since either can follow a period of background throttling.
 */
export function useVisibilityRefresh(onVisible: () => void): void {
  const callbackRef = useRef(onVisible);
  callbackRef.current = onVisible;

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === 'visible') callbackRef.current();
    };
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    return () => {
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
  }, []);
}

'use client';

import { useEffect, useState } from 'react';

export function useRotatingState(states: string[], intervalMs = 4000): string {
  const [state, setState] = useState(states[0] ?? '');

  useEffect(() => {
    if (states.length === 0) return;
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % states.length;
      setState(states[i]);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [states, intervalMs]);

  return state;
}

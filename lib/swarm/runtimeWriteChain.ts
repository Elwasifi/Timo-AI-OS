// M7-13g: runtime bookkeeping writes (runtime_activity events, the singleton
// runtime_state row) that orchestrate() used to AWAIT inline — three of them
// before routing even began and several more after the reply was generated.
// Nothing the user's reply depends on needs them to have finished: they feed the
// activity feed / G-Brain, which are eventually consistent anyway. But each is a
// Supabase request that first goes through auth.getSession() and its navigator
// lock, so on a stuck lock (5s wait + up to 10s token refresh + up to 15s REST)
// four of them in a row could outlast the chat watchdog (observed live, M7-13g).
//
// This runs them in ONE background chain: relative order is preserved (a slow
// 'routing' write can never land after a later 'completed' write from the same
// request), the caller never awaits them, and a failure only produces a warning —
// the chain itself can never reject, so there is no unhandled rejection.
//
// KNOWN LIMITATION (accepted): the chain is PER REQUEST (one per orchestrate()
// call), not global. Ordering is therefore guaranteed only among one request's
// own writes. If the network is slow, a late 'completed' write from request N can
// land AFTER the 'routing' write of request N+1, leaving the singleton
// runtime_state row showing request N+1's older state until its own later writes
// land. The effect is limited to the dashboard's runtime_state being briefly
// stale; nothing the reply or any mission depends on reads it. A global chain
// would couple unrelated requests (one stuck write would queue every later
// request behind it), which is worse than brief staleness, so it is not done.

import { logger } from '@/lib/utils/logger';
import { traceStep } from '@/lib/utils/sendTrace';

export interface RuntimeWriteChain {
  /** Queue a write behind the ones already queued. Returns immediately. */
  enqueue: (label: string, write: () => Promise<unknown>) => void;
  /** Resolves when everything queued so far has settled, or after `ms`, whichever is first. Never rejects. */
  settledWithin: (ms: number) => Promise<void>;
}

export function createRuntimeWriteChain(): RuntimeWriteChain {
  let chain: Promise<void> = Promise.resolve();

  return {
    enqueue(label, write) {
      chain = chain.then(async () => {
        try {
          await write();
          traceStep(`runtime write done: ${label}`);
        } catch (err) {
          logger.systemWarn(`runtime write failed (${label}): ${err instanceof Error ? err.message : String(err)}`);
          traceStep(`runtime write FAILED: ${label}`);
        }
      });
    },

    async settledWithin(ms) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cap = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
      try {
        await Promise.race([chain, cap]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

// M7-13g: bounded "make sure a conversation exists" step for send().
//
// send() used to `await crewCoordinator.startConversation()` before doing
// anything else. That is a REST insert, and every Supabase request first passes
// through auth.getSession() and its navigator lock — so on a profile where the
// lock was held by a stuck tab (lock wait 5s + token refresh up to 10s + REST up
// to 15s) the chat sat on that single await, with no "thinking" indicator and
// outside the page watchdog, until the user gave up (observed live: a hard
// refresh in Amro's normal Chrome profile; Incognito was fast).
//
// Behavior now:
//   - If a conversation already exists, nothing happens ('existing').
//   - Otherwise start one, but wait at most CONVERSATION_START_TIMEOUT_MS. On
//     timeout or failure the reply CONTINUES without it ('timeout' / 'failed').
//   - The start is shared: while one is still in flight (even after this turn
//     stopped waiting for it) another send() joins the SAME promise instead of
//     inserting a second conversation, so a slow insert can never create
//     duplicates.
//   - When a timed-out start eventually succeeds, `onStarted` still runs (the
//     page uses it to remember the id in localStorage) and the coordinator
//     already holds the id, so the next turn is persisted normally.
//
// PERSISTENCE TRADE-OFF for the one affected turn: crew-coordinator's
// persistMessage() is a no-op while there is no conversation id, so that
// turn's USER message is not stored, and the assistant message is stored only
// if the late start finishes before the reply does. The chat itself is
// unaffected; only that single turn is missing or incomplete in the history.

export const CONVERSATION_START_TIMEOUT_MS = 8_000;

export type EnsureConversationStatus = 'existing' | 'started' | 'timeout' | 'failed';

export interface EnsureConversationDeps {
  getConversationId: () => string | null;
  /** Resolves to the new id, or '' on failure (crewCoordinator.startConversation never throws). */
  startConversation: (title: string, agentId: string) => Promise<string>;
  /** Runs once for every successful start — including one that finishes after this turn gave up waiting. */
  onStarted?: (id: string) => void;
}

export interface EnsureConversationResult {
  status: EnsureConversationStatus;
  id: string | null;
}

let inflight: Promise<string> | null = null;

/** Test-only: forget the shared in-flight start. */
export function __resetEnsureConversationForTesting(): void {
  inflight = null;
}

export async function ensureConversationBounded(
  deps: EnsureConversationDeps,
  title: string,
  timeoutMs: number = CONVERSATION_START_TIMEOUT_MS,
): Promise<EnsureConversationResult> {
  const existing = deps.getConversationId();
  if (existing) return { status: 'existing', id: existing };

  if (!inflight) {
    const started: Promise<string> = Promise.resolve()
      .then(() => deps.startConversation(title, 'temo'))
      .catch(() => '')
      .then((id) => {
        if (id) deps.onStarted?.(id);
        return id;
      });
    inflight = started;
    // Clear only our own entry, once it settles (success, failure or very late).
    void started.finally(() => {
      if (inflight === started) inflight = null;
    });
  }

  const TIMED_OUT = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const outcome = await Promise.race([inflight, timeout]);
    if (outcome === TIMED_OUT) return { status: 'timeout', id: null };
    return outcome ? { status: 'started', id: outcome } : { status: 'failed', id: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

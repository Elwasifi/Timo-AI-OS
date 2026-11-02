// M7-13g: lightweight timing trace for one chat send() — one logger line per
// step with the elapsed milliseconds since send() started. Labels only: never
// message text, ids or payloads. Used to see WHICH step a slow or stuck send is
// waiting on (conversation start, each runtime write, routing begin, first
// token, final reply). Info-level logger lines print only in development, so
// this adds nothing to a production console.
//
// endSendTrace() clears the clock, so work that did not start from the chat
// page's send() (voice, background tasks) logs nothing instead of printing
// elapsed times relative to a stale start.

import { logger } from './logger';

let startedAt = 0;

export function startSendTrace(): void {
  startedAt = Date.now();
  logger.system('[send] +0ms send() start');
}

export function traceStep(step: string): void {
  if (!startedAt) return;
  logger.system(`[send] +${Date.now() - startedAt}ms ${step}`);
}

export function endSendTrace(): void {
  startedAt = 0;
}

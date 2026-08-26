// Shared HTTP helpers for talking to upstream providers — used by both the
// chat dispatcher (index.ts) and every adapter's listModels() (Provider
// Validation & Model Discovery pass, 2026-08-20). Centralized here so
// adapters can import it without reaching into index.ts (which imports the
// adapter registry — importing the other way would be circular).

// Matches the existing task/n8n timeout convention in this codebase
// (lib/swarm/executionLayer.ts's default task_timeout_ms, and
// AppSettings.n8n_timeout) rather than an arbitrary new value.
export const UPSTREAM_TIMEOUT_MS = 30000;
// Model-listing calls are lightweight metadata reads, not generations — a
// much shorter timeout is appropriate so a slow/unreachable provider fails
// the "Validate" button fast instead of leaving the UI stuck for 30s.
export const VALIDATE_TIMEOUT_MS = 10000;

/** Preserves the real upstream HTTP status through to the caller. */
export class UpstreamError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UpstreamError(`${label} request timed out after ${timeoutMs}ms`, 504);
    }
    throw new UpstreamError(`${label} request failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}

// web.search: per-tenant Gemini cooldown (M7-13c-2a-6). In-memory, per server instance, PURE apart from the clock.
//
// After Gemini fails with a quota error or with "search grounding is not available on this key" (a free-tier key), the same
// call would fail again in 2–9 s for every following task. So that tenant skips Gemini for a window and goes straight to the
// fallback provider. Keyed by tenant (never shared across tenants), expires on its own, clock injectable for tests.
// Honest limit: it lives in the memory of one server instance — a restart or another instance starts with no cooldown.

export type GeminiCooldownReason = 'quota' | 'unavailable';

/** Daily quota: back off for 10 minutes. */
export const GEMINI_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
/** "Grounding unavailable on this key tier": that does not change within the hour. */
export const GEMINI_UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;

export interface ActiveCooldown {
  reason: GeminiCooldownReason;
  /** The readable sentence of the failure that started it (shown again while the cooldown lasts). */
  message: string;
  remainingMs: number;
}

export class GeminiCooldown {
  private entries = new Map<string, { until: number; reason: GeminiCooldownReason; message: string }>();

  constructor(private now: () => number = Date.now) {}

  /** Test hook: replace the clock. */
  setClock(now: () => number): void {
    this.now = now;
  }

  /** Test hook: forget everything. */
  reset(): void {
    this.entries.clear();
  }

  start(tenantId: string, reason: GeminiCooldownReason, message: string): void {
    const ms = reason === 'quota' ? GEMINI_QUOTA_COOLDOWN_MS : GEMINI_UNAVAILABLE_COOLDOWN_MS;
    this.entries.set(tenantId, { until: this.now() + ms, reason, message });
  }

  /** The active cooldown of THIS tenant, or null (an expired entry is dropped). */
  active(tenantId: string): ActiveCooldown | null {
    const e = this.entries.get(tenantId);
    if (!e) return null;
    const remainingMs = e.until - this.now();
    if (remainingMs <= 0) {
      this.entries.delete(tenantId);
      return null;
    }
    return { reason: e.reason, message: e.message, remainingMs };
  }
}

/** The process-wide instance used by webSearchCore. */
export const geminiCooldown = new GeminiCooldown();

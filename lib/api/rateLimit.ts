// Token-bucket rate limiting for API routes that can trigger an AI call or
// a tool execution (M1-03, docs/BACKLOG-M1.md). Atomic check-and-consume
// lives in the check_rate_limit() Postgres function (see the migration) —
// this module is just the typed wrapper + IP extraction helper.

import type { NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/serverClient';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimitOptions {
  /** Bucket capacity — the burst ceiling. */
  maxTokens: number;
  /** Steady-state refill rate. */
  refillPerSec: number;
  /** Tokens this call consumes (default 1). */
  cost?: number;
}

/**
 * Checks and consumes from a named token bucket. Fails OPEN (allows the
 * request) on any infrastructure error — a broken rate limiter must never
 * become an outage for real traffic; the routes that call this already have
 * their own auth/budget gates as the actual safety backstop.
 */
export async function checkRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  try {
    const client = getServiceRoleClient();
    const { data, error } = await client.rpc('check_rate_limit', {
      p_key: key,
      p_max_tokens: opts.maxTokens,
      p_refill_per_sec: opts.refillPerSec,
      p_cost: opts.cost ?? 1,
    });
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      return { allowed: true, remaining: opts.maxTokens, resetSeconds: 0 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { allowed: !!row.allowed, remaining: Number(row.remaining), resetSeconds: Number(row.reset_seconds) };
  } catch {
    return { allowed: true, remaining: opts.maxTokens, resetSeconds: 0 };
  }
}

/**
 * Best-effort caller IP from standard proxy headers (Vercel/most reverse
 * proxies set x-forwarded-for; falls back to a constant so a missing header
 * still buckets together rather than bypassing the limit entirely).
 */
export function getClientIp(req: NextRequest | Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

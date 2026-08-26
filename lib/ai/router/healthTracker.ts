// Dynamic Model Router — provider/model health tracking.
//
// usage_ledger only ever records successful calls (by explicit design —
// see its migration header), so it has zero failure/latency signal. This
// module is the health-aware counterpart: a narrow, incrementally-updated
// counter table (provider_model_health), not a full event log — per the
// mission's explicit "do not build an unnecessarily complicated
// observability platform" instruction.

import { supabase } from '@/lib/supabase/client';
import type { ProviderId } from '@/lib/settings/settings-service';
import type { ModelHealth } from './types';

const HEALTH_CACHE_TTL_MS = 60 * 1000; // short — health should reflect recent reality
let cache: { rows: Map<string, ModelHealth>; fetchedAt: number } | null = null;

function key(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

async function loadHealthRows(): Promise<Map<string, ModelHealth>> {
  if (cache && Date.now() - cache.fetchedAt < HEALTH_CACHE_TTL_MS) {
    return cache.rows;
  }
  const map = new Map<string, ModelHealth>();
  const { data, error } = await supabase
    .from('provider_model_health')
    .select('provider, model_id, success_count, failure_count, consecutive_failures, avg_latency_ms, last_success_at, last_failure_at, last_status_code');
  if (!error && data) {
    for (const row of data as Array<Record<string, unknown>>) {
      map.set(key(row.provider as string, row.model_id as string), {
        provider: row.provider as ProviderId,
        modelId: row.model_id as string,
        successCount: row.success_count as number,
        failureCount: row.failure_count as number,
        consecutiveFailures: row.consecutive_failures as number,
        avgLatencyMs: row.avg_latency_ms as number | null,
        lastSuccessAt: row.last_success_at as string | null,
        lastFailureAt: row.last_failure_at as string | null,
        lastStatusCode: row.last_status_code as number | null,
      });
    }
  }
  cache = { rows: map, fetchedAt: Date.now() };
  return map;
}

export async function getHealth(provider: ProviderId, modelId: string): Promise<ModelHealth | null> {
  const rows = await loadHealthRows();
  return rows.get(key(provider, modelId)) ?? null;
}

export async function getAllHealth(): Promise<Map<string, ModelHealth>> {
  return loadHealthRows();
}

/**
 * Fire-and-forget, matching the existing non-blocking recordUsage()
 * pattern in lib/ai/ai-provider.ts — a health-write failure must never
 * delay or fail the caller's actual AI request.
 */
export function recordHealth(input: {
  provider: ProviderId;
  modelId: string;
  success: boolean;
  latencyMs: number | null;
  statusCode: number | null;
}): void {
  void Promise.resolve(
    supabase.rpc('record_provider_model_health', {
      p_provider: input.provider,
      p_model_id: input.modelId,
      p_success: input.success,
      p_latency_ms: input.latencyMs,
      p_status_code: input.statusCode,
    }),
  ).then(
    () => {
      // Invalidate so the next routing decision sees the fresh counters
      // rather than serving up to 60s of stale health data right after a
      // failure that should immediately deprioritize this candidate.
      cache = null;
    },
    () => {
      // Health tracking is advisory — never surface this to the caller.
    },
  );
}

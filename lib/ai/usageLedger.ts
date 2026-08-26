// Usage Ledger — Sprint 3 Cost Governance Foundation
//
// Append-only recording of AI provider consumption (tokens, model, cost)
// plus minimal read/reporting functions. Written from the single choke
// point every AI call already passes through — chatWithFallback() in
// lib/ai/ai-provider.ts — so no other call site needs to change to get
// basic usage recording; callers may optionally pass a UsageContext for
// mission/task/agent attribution.
//
// Failure to record usage NEVER throws — recordUsage() always resolves,
// logging a warning on error, so a database or network hiccup here can
// never fail an otherwise-successful AI call.

import { supabase } from '@/lib/supabase/client';
import { logger } from '@/lib/utils/logger';
import { estimateCost } from './pricing';
import type { ProviderId } from '@/lib/settings/settings-service';

export interface UsageContext {
  /** Logical operation type, e.g. 'chat' | 'tool_response' | 'worker_execution' | 'manager_review' | 'mission_task'. Defaults to 'chat'. */
  operation?: string;
  missionId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  managerId?: string | null;
  /** V1: attributes this usage row (and therefore cost) to a tenant for budget governance. */
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordUsageInput {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  context?: UsageContext;
  /** Wall-clock duration of the provider call, when known — feeds the Dynamic Model Router's latency scoring (lib/ai/router). */
  latencyMs?: number;
}

/**
 * Record one successful AI completion's usage. Never throws — errors are
 * logged via logger.providerWarn and swallowed, per Sprint 3's
 * non-blocking-failure requirement.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    const { cost, isEstimated } = estimateCost(
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
    );

    const { error } = await supabase.from('usage_ledger').insert({
      provider: input.provider,
      model: input.model,
      operation: input.context?.operation ?? 'chat',
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      estimated_cost: cost,
      cost_is_estimated: isEstimated,
      mission_id: input.context?.missionId ?? null,
      task_id: input.context?.taskId ?? null,
      agent_id: input.context?.agentId ?? null,
      manager_id: input.context?.managerId ?? null,
      tenant_id: input.context?.tenantId ?? null,
      metadata: input.context?.metadata ?? {},
      latency_ms: input.latencyMs ?? null,
    });

    if (error) {
      logger.providerWarn(`Usage ledger insert failed: ${error.message}`);
    }
  } catch (err) {
    logger.providerWarn(
      `Usage ledger recording failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---- Reporting (read-only) ----
// Minimal aggregate readers for future cost-monitoring surfaces. No UI is
// built in this sprint — these are service-layer functions only.

export interface UsageLedgerRow {
  id: string;
  created_at: string;
  provider: string;
  model: string;
  operation: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number | null;
  cost_is_estimated: boolean;
  mission_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  manager_id: string | null;
  tenant_id: string | null;
}

export interface UsageTotals {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  /** Sum of known costs only — rows with a null estimated_cost are excluded. */
  totalEstimatedCost: number;
  /** Count of rows whose cost could not be estimated (no pricing entry). */
  unpricedCalls: number;
}

function summarize(rows: UsageLedgerRow[]): UsageTotals {
  const totals: UsageTotals = {
    totalCalls: rows.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalEstimatedCost: 0,
    unpricedCalls: 0,
  };

  for (const row of rows) {
    totals.totalInputTokens += row.input_tokens;
    totals.totalOutputTokens += row.output_tokens;
    totals.totalTokens += row.total_tokens;
    if (row.estimated_cost === null) {
      totals.unpricedCalls += 1;
    } else {
      totals.totalEstimatedCost += row.estimated_cost;
    }
  }

  totals.totalEstimatedCost = Number(totals.totalEstimatedCost.toFixed(6));
  return totals;
}

async function fetchRows(filter?: {
  provider?: string;
  model?: string;
  missionId?: string;
  agentId?: string;
  managerId?: string;
  tenantId?: string;
}): Promise<UsageLedgerRow[]> {
  let query = supabase
    .from('usage_ledger')
    .select(
      'id, created_at, provider, model, operation, input_tokens, output_tokens, total_tokens, estimated_cost, cost_is_estimated, mission_id, task_id, agent_id, manager_id, tenant_id',
    );

  if (filter?.provider) query = query.eq('provider', filter.provider);
  if (filter?.model) query = query.eq('model', filter.model);
  if (filter?.missionId) query = query.eq('mission_id', filter.missionId);
  if (filter?.agentId) query = query.eq('agent_id', filter.agentId);
  if (filter?.managerId) query = query.eq('manager_id', filter.managerId);
  if (filter?.tenantId) query = query.eq('tenant_id', filter.tenantId);

  const { data, error } = await query;
  if (error) {
    logger.providerWarn(`Usage ledger read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as UsageLedgerRow[];
}

/** Total usage/cost across the entire ledger. */
export async function getTotalUsage(): Promise<UsageTotals> {
  return summarize(await fetchRows());
}

export interface ProviderUsageShare {
  provider: string;
  totalTokens: number;
  totalCost: number;
  /** 0-100, share of total tokens across all providers. */
  sharePercent: number;
}

/** Token/cost breakdown by provider, for a real (not decorative) usage
 * distribution view — e.g. the Command Deck's "Resource Distribution" panel. */
export async function getUsageBreakdownByProvider(): Promise<ProviderUsageShare[]> {
  const rows = await fetchRows();
  const totalTokens = rows.reduce((sum, r) => sum + r.total_tokens, 0);
  const byProvider = new Map<string, { totalTokens: number; totalCost: number }>();
  for (const row of rows) {
    const entry = byProvider.get(row.provider) ?? { totalTokens: 0, totalCost: 0 };
    entry.totalTokens += row.total_tokens;
    entry.totalCost += row.estimated_cost ?? 0;
    byProvider.set(row.provider, entry);
  }
  return Array.from(byProvider.entries())
    .map(([provider, v]) => ({
      provider,
      totalTokens: v.totalTokens,
      totalCost: Number(v.totalCost.toFixed(6)),
      sharePercent: totalTokens > 0 ? Math.round((v.totalTokens / totalTokens) * 100) : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Usage/cost for a single provider. */
export async function getUsageByProvider(provider: string): Promise<UsageTotals> {
  return summarize(await fetchRows({ provider }));
}

/** Usage/cost for a single model. */
export async function getUsageByModel(model: string): Promise<UsageTotals> {
  return summarize(await fetchRows({ model }));
}

/** Usage/cost for a single mission. */
export async function getUsageByMission(missionId: string): Promise<UsageTotals> {
  return summarize(await fetchRows({ missionId }));
}

/** Usage/cost for a single tenant (V1 budget governance). */
export async function getUsageByTenant(tenantId: string): Promise<UsageTotals> {
  return summarize(await fetchRows({ tenantId }));
}

/** Usage/cost attributable to a single agent (worker or manager acting as executor). */
export async function getUsageByAgent(agentId: string): Promise<UsageTotals> {
  return summarize(await fetchRows({ agentId }));
}

/** Usage/cost attributable to a single manager (across its own calls and its workers' delegated calls where manager_id was set). */
export async function getUsageByManager(managerId: string): Promise<UsageTotals> {
  return summarize(await fetchRows({ managerId }));
}

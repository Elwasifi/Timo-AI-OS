// Entitlements — V1 package/credit enforcement (Section 14).
//
// Minimal, honest V1: checks a tenant's package limits before allowing a
// new mission. Does not implement billing — that stays modular (Stripe or
// similar can write into `tenant_entitlements` later without this check
// changing). Reuses the existing Supabase client; no new abstraction.

import { supabase } from '@/lib/supabase/client';

export interface EntitlementCheck {
  allowed: boolean;
  reason?: string;
  creditsRemaining: number | null;
  projectsUsed: number;
  projectLimit: number | null;
}

interface EntitlementRow {
  package_id: string;
  credits_remaining: number | null;
  projects_used: number;
  packages: { project_limit: number | null; credit_limit: number | null } | null;
}

/** Check whether a tenant may start a new mission (project) right now. */
export async function checkEntitlement(tenantId: string): Promise<EntitlementCheck> {
  const { data, error } = await supabase
    .from('tenant_entitlements')
    .select('package_id, credits_remaining, projects_used, packages ( project_limit, credit_limit )')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) {
    // No entitlement row yet (e.g. internal tenant, or provisioning race) —
    // fail open for the internal tenant only; unknown client tenants are
    // blocked rather than silently unlimited.
    if (tenantId === '00000000-0000-0000-0000-000000000001') {
      return { allowed: true, creditsRemaining: null, projectsUsed: 0, projectLimit: null };
    }
    return {
      allowed: false,
      reason: 'No active package found for this workspace.',
      creditsRemaining: null,
      projectsUsed: 0,
      projectLimit: null,
    };
  }

  const row = data as unknown as EntitlementRow;
  const projectLimit = row.packages?.project_limit ?? null;
  const creditsRemaining = row.credits_remaining;

  if (projectLimit !== null && row.projects_used >= projectLimit) {
    return {
      allowed: false,
      reason: `Project limit reached (${row.projects_used}/${projectLimit}) for the "${row.package_id}" package. Upgrade to start a new mission.`,
      creditsRemaining,
      projectsUsed: row.projects_used,
      projectLimit,
    };
  }

  if (creditsRemaining !== null && creditsRemaining <= 0) {
    return {
      allowed: false,
      reason: `Credits exhausted for the "${row.package_id}" package. Upgrade or wait for the next billing period.`,
      creditsRemaining,
      projectsUsed: row.projects_used,
      projectLimit,
    };
  }

  return { allowed: true, creditsRemaining, projectsUsed: row.projects_used, projectLimit };
}

/** Record that a tenant consumed one project slot (call after a mission is successfully created). */
export async function consumeProjectSlot(tenantId: string): Promise<void> {
  const { data } = await supabase
    .from('tenant_entitlements')
    .select('projects_used')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!data) return;

  await supabase
    .from('tenant_entitlements')
    .update({ projects_used: (data.projects_used as number) + 1, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
}

/** Check a tenant's monthly spend against its configured budget (Section 9). */
export async function checkBudget(tenantId: string): Promise<{ withinBudget: boolean; spendUsd: number; limitUsd: number | null; alertTriggered: boolean }> {
  const { data: budget } = await supabase
    .from('budgets')
    .select('monthly_limit_usd, alert_threshold_pct, current_period_start')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!budget || budget.monthly_limit_usd === null) {
    return { withinBudget: true, spendUsd: 0, limitUsd: null, alertTriggered: false };
  }

  const { data: rows } = await supabase
    .from('usage_ledger')
    .select('estimated_cost')
    .eq('tenant_id', tenantId)
    .gte('created_at', budget.current_period_start);

  const spendUsd = (rows ?? []).reduce((sum, r) => sum + (Number(r.estimated_cost) || 0), 0);
  const limitUsd = Number(budget.monthly_limit_usd);
  const alertTriggered = limitUsd > 0 && (spendUsd / limitUsd) * 100 >= budget.alert_threshold_pct;

  return { withinBudget: spendUsd < limitUsd, spendUsd, limitUsd, alertTriggered };
}

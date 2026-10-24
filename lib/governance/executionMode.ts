// M7-05 — Live / Sandbox / Simulation execution mode.
//
// Storage design (confirmed with the user before implementation): a single
// per-tenant default column (tenants.execution_mode), overridable per-call
// via ToolRequest.executionMode. No per-tool default column — the ticket's
// "minimal design that satisfies the ticket" — a tool that wants a stricter
// default than its tenant can still pass executionMode explicitly per call.
//
// Deliberately orthogonal to the pre-existing whole-mission isSimulation
// flag — see the ExecutionMode comment in lib/tools/types.ts.

import { supabase } from '@/lib/supabase/client';
import type { ExecutionMode, ToolCategory } from '@/lib/tools/types';

/**
 * Dedicated tenant used ONLY as the isolated destination for sandbox-mode
 * writes from tools with a real handler (currently: memory.*). Never used
 * for anything else — not a client tenant, not the internal operator
 * tenant (lib/governance/internalTenant.ts's INTERNAL_TENANT_ID, which is
 * a completely different concept: "acting as Temo's own operator" vs. this
 * tenant's sole purpose being "an isolated place for sandbox-mode calls to
 * land that is never read by anything production-facing").
 */
export const SANDBOX_TENANT_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Confirmed by investigation (M7-05 scoping): only memory.* tools have a
 * real handler that performs a genuine, tenant-scoped DB write, making a
 * real isolated "sandbox" meaningful (routing to SANDBOX_TENANT_ID instead
 * of the caller's real tenant). n8n.* goes through one single global n8n
 * instance with one API key (services/n8n/n8nClient.ts) — no isolated
 * environment exists to route to. google, github, and files tools are all
 * unimplemented placeholderTools that throw regardless of mode. For every
 * category NOT in this set, sandbox mode degrades to simulation-equivalent
 * behavior (confirmed decision, not a workaround) rather than either
 * silently running for real or fabricating a fake "isolated" execution
 * that doesn't actually exist.
 */
const CATEGORIES_WITH_REAL_SANDBOX_ISOLATION: ReadonlySet<ToolCategory> = new Set<ToolCategory>(['memory']);

export function categoryHasRealSandboxIsolation(category: ToolCategory): boolean {
  return CATEGORIES_WITH_REAL_SANDBOX_ISOLATION.has(category);
}

/** Looks up a tenant's configured default execution mode. Falls back to 'sandbox' (the safe default) if the tenant row can't be read — fail-closed, never fail-open to 'live'. */
export async function getTenantExecutionMode(tenantId: string | null | undefined): Promise<ExecutionMode> {
  if (!tenantId) return 'sandbox';
  const { data, error } = await supabase
    .from('tenants')
    .select('execution_mode')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data) return 'sandbox';
  const mode = (data as { execution_mode: string }).execution_mode;
  if (mode === 'live' || mode === 'sandbox' || mode === 'simulation') return mode;
  return 'sandbox';
}

/** Applies an approved Live-mode switch for a tenant. Called only from the mode_change approval branch in the confirm route — never invoked directly "for convenience" (CLAUDE.md). */
export async function setTenantExecutionMode(tenantId: string, mode: ExecutionMode): Promise<boolean> {
  const { error } = await supabase.from('tenants').update({ execution_mode: mode }).eq('id', tenantId);
  return !error;
}

-- M7-05 — Live / Sandbox / Simulation execution mode.
--
-- Adds a per-tenant default execution mode (tenants.execution_mode),
-- resolved in lib/tools/executor.ts as:
--   request.isSimulation ? 'simulation' : (request.executionMode ?? tenantDefault)
--
-- New tenants default to 'sandbox' (the ticket's requirement: "Default
-- mode for any new company/tool must be Sandbox or Simulation"). The
-- pre-existing internal tenant is explicitly grandfathered to 'live'
-- below — it already performs real actions today (chat, memory, n8n),
-- and silently defaulting it to 'sandbox' would redirect its real memory
-- writes into the new sandbox tenant and gate every already-working
-- gated tool a second, unexpected time. This is a deliberate one-time
-- exception for the one tenant that predates this ticket, not a general
-- opt-out — switching any tenant (including this one) back to 'live'
-- going forward requires the mode_change approval flow
-- (lib/governance/executionMode.ts's setTenantExecutionMode(), only ever
-- called from the approved branch of app/api/approvals/[id]/confirm).
--
-- Also seeds a dedicated sandbox tenant (id
-- 00000000-0000-0000-0000-000000000002) — the isolated destination
-- sandbox-mode calls route to for tool categories with a real handler
-- (currently: memory.*). Never used for anything else.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, an UPDATE that converges to the
-- same value on re-run, and an INSERT ... ON CONFLICT DO UPDATE.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'sandbox'
    CHECK (execution_mode IN ('live', 'sandbox', 'simulation'));

UPDATE tenants
SET execution_mode = 'live'
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO tenants (id, name, slug, kind, execution_mode)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Sandbox Environment',
  'sandbox',
  'internal',
  'sandbox'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  execution_mode = EXCLUDED.execution_mode;

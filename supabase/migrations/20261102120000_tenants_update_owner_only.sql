-- M7-13c-2a-3 — close the tenants.execution_mode (and every other column) browser-write hole.
--
-- FINDING (from reading the migrations; the live policy is verified by the dry-run transcript that
-- accompanies this migration): 20260819140000_create_v1_corporate_os_foundation.sql:106-108 created
--   CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE TO authenticated
--     USING (is_tenant_member(id)) WITH CHECK (is_tenant_member(id));
-- Despite the name, is_tenant_member() ignores the role, so ANY member of a tenant could UPDATE ANY column of
-- their tenant row from the browser (anon key + session) — including execution_mode -> 'live',
-- bypassing the M7-05 approval design ("never switch directly").
--
-- FIX (privilege-only; no data is read or changed):
--   1. is_tenant_owner(uuid): SECURITY DEFINER sibling of is_tenant_member() that also requires
--      tenant_members.role = 'owner'.
--   2. The UPDATE policy now requires the OWNER (USING and WITH CHECK).
--   3. Column-level hardening: UPDATE on tenants is revoked from anon and authenticated entirely.
--      Nothing in app/, lib/, components/ or supabase/functions/ updates tenants from the browser
--      (the only writer is lib/governance/executionMode.ts setTenantExecutionMode(), which runs
--      server-side with the service role), so NO column is re-granted: execution_mode — and
--      name/slug/kind/package_id — can only change through the server. Should a future ticket
--      need an Owner-editable column (e.g. company name), add GRANT UPDATE (name) ON tenants TO
--      authenticated; the owner-only policy above would then apply to it.
--   4. service_role keeps full access (explicit GRANT, harmless if already present).
-- SELECT/INSERT/DELETE privileges and policies are untouched. Triggers/SECURITY DEFINER functions that
-- provision tenants run as their owner and are unaffected by the REVOKE.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY, REVOKE/GRANT converge to
-- the same state on re-run. Rollback: supabase/rollbacks/20261102120000_tenants_update_owner_only_ROLLBACK.sql

CREATE OR REPLACE FUNCTION is_tenant_owner(check_tenant_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE tenant_id = check_tenant_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE
  TO authenticated USING (is_tenant_owner(id)) WITH CHECK (is_tenant_owner(id));

REVOKE UPDATE ON tenants FROM anon, authenticated;
GRANT ALL ON tenants TO service_role;

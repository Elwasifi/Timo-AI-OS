-- ROLLBACK for 20261102120000_tenants_update_owner_only.sql — restores the pre-fix state exactly as the
-- V1 foundation migration created it (member-wide UPDATE policy + Supabase's default table privileges).
-- NOTE: this REOPENS the hole where any tenant member can set tenants.execution_mode to 'live' from the browser.
-- Run manually, only if the owner-only policy breaks something legitimate.

DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE
  TO authenticated USING (is_tenant_member(id)) WITH CHECK (is_tenant_member(id));

GRANT UPDATE ON tenants TO anon, authenticated;
DROP FUNCTION IF EXISTS is_tenant_owner(uuid);

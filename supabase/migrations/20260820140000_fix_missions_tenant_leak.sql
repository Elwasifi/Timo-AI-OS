/*
# Fix missions table cross-tenant data leak

Discovered live during the mission_timeline RLS audit (delegation-unification
+ security pass): 20260819140000_create_v1_corporate_os_foundation.sql
intended to replace the original anon-open policies on `missions`
(20260727233657_create_mission_engine_and_task_queue.sql) with tenant-scoped
ones, but named them wrong when dropping:

  DROP POLICY IF EXISTS "missions_select_all" ON missions;   -- never existed
  DROP POLICY IF EXISTS "missions_insert_all" ON missions;   -- never existed
  DROP POLICY IF EXISTS "missions_update_all" ON missions;   -- never existed

The actual policies created by the original migration are named
"mission_select_all" / "mission_insert_all" / "mission_update_all" /
"mission_delete_all" (singular "mission_", not "missions_"). Because
DROP POLICY IF EXISTS silently no-ops on a name that doesn't exist, those
four original policies — TO anon, authenticated USING (true)/WITH CHECK
(true), i.e. every mission readable/writable/deletable by anyone, including
fully unauthenticated requests — were never removed. They kept sitting
alongside the new tenant-scoped policies (RLS policies are OR'd together),
so the permissive ones won regardless of what the tenant-scoped ones said.

Confirmed live: an authenticated member of Tenant A could read a mission
belonging to Tenant B directly by id.

mission_objectives/mission_tasks/mission_timeline were NOT affected — that
same migration cleaned them up via a dynamic
`SELECT policyname FROM pg_policies WHERE tablename = tbl` loop, which drops
whatever actually exists instead of guessing a name, and confirmed live to
be correctly enforcing tenant isolation today.

Fix: drop missions' policies the same way (by looking them up, not
guessing), then recreate the intended tenant-scoped set. Additive/idempotent
— no table dropped or recreated, no mission data touched, safe to re-run.
*/

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'missions' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON missions', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "missions_select_tenant" ON missions FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "missions_insert_tenant" ON missions FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "missions_update_tenant" ON missions FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
-- No authenticated DELETE policy, matching the existing pattern on
-- mission_objectives/mission_tasks/mission_timeline — deletion (if ever
-- needed) goes through the service-role path, not client sessions.

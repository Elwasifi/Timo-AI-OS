-- ============================================================
-- Milestone 5, Stage 1 — Security containment (S0-02, S0-03, S0-04)
--
-- The Deep Integrity Audit (2026-08-29) found live pg_policies had
-- drifted from what the migration chain intended: 20260819140000's
-- Section 9/10 DROP+recreate loops should have left app_settings,
-- conversations, messages, fact_revisions, and memory_settings
-- authenticated/tenant-scoped only, but a live `select * from pg_policies`
-- confirmed permissive anon_* policies (USING (true), TO anon,
-- authenticated) still coexist alongside the newer correct ones on
-- app_settings/conversations/messages, and fact_revisions/memory_settings
-- were never tightened at all. Since Postgres RLS policies are OR'd
-- together, the old permissive policy alone was enough to expose every
-- row regardless of the newer restrictive policy sitting next to it.
--
-- This migration does not trust the migration chain's history to know
-- what's live — it drops every existing policy on each affected table
-- unconditionally (same defensive pattern as 20260819140000's own
-- Section 10 comment: "not just anon-named ones... no stale permissive
-- policy can survive under a naming convention we didn't anticipate")
-- and recreates only the intended policies from a clean slate.
-- ============================================================

-- ---- S0-03: app_settings — authenticated only, no anon access ----
-- Provider API keys live in this single-row table. The old keys are
-- being rotated separately (S0-01, owner action outside this
-- migration); this closes the hole that exposed them.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'app_settings' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app_settings', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "app_settings_authenticated_select" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_authenticated_insert" ON app_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "app_settings_authenticated_update" ON app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ---- S0-03: conversations — authenticated + tenant-scoped only ----
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'conversations' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON conversations', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "conversations_tenant_select" ON conversations FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "conversations_tenant_insert" ON conversations FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "conversations_tenant_update" ON conversations FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- ---- S0-03: messages — authenticated, scoped through parent conversation ----
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'messages' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON messages', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "messages_tenant_select" ON messages FOR SELECT TO authenticated USING (
  conversation_id IN (SELECT id FROM conversations WHERE is_tenant_member(tenant_id))
);
CREATE POLICY "messages_tenant_insert" ON messages FOR INSERT TO authenticated WITH CHECK (
  conversation_id IN (SELECT id FROM conversations WHERE is_tenant_member(tenant_id))
);

-- ---- S0-04: fact_revisions — drop anon DELETE/INSERT/SELECT ----
-- Confirmed (Deep Integrity Audit, Section H2) zero application-code
-- references — this is a write-only audit log populated only by
-- SECURITY DEFINER RPCs (20260727202804, 20260727203441, 20260727203453),
-- which bypass RLS entirely. authenticated SELECT is enough for any
-- future UI that wants to display the audit trail; there is no
-- legitimate client-side INSERT/DELETE path.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'fact_revisions' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON fact_revisions', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "fact_revisions_authenticated_select" ON fact_revisions FOR SELECT TO authenticated USING (true);

-- ---- S0-04: memory_settings — drop anon SELECT/UPDATE ----
-- Single-row global embedding/provider config. authenticated SELECT and
-- UPDATE preserved (matches the "global by design" pattern already used
-- for agent_registry/business_units) — just no longer reachable by anon.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'memory_settings' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON memory_settings', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "memory_settings_authenticated_select" ON memory_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "memory_settings_authenticated_update" ON memory_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ---- S0-02: tenant_members — remove the unconstrained self-insert policy ----
-- tenant_members_insert_self only checked `user_id = auth.uid()` with no
-- tenant_id constraint, and the role column defaults to 'owner' — any
-- authenticated user could insert themselves as owner of ANY tenant,
-- including the internal Temo Corporate tenant, defeating every
-- is_tenant_member() check downstream (including the M1-06/M2-01 fixes).
--
-- The only legitimate write path for this table is already server-side
-- and doesn't need a client policy at all: provision_tenant_for_new_user()
-- (this file's own Section 11, defined earlier in this migration chain)
-- is SECURITY DEFINER and fires on auth.users INSERT, bypassing RLS
-- entirely. Confirmed via grep that no application code writes to
-- tenant_members through the client-side (anon/authenticated-key)
-- Supabase client anywhere — every read goes through the service-role
-- client in lib/auth/apiAuth.ts. There is no invite-acceptance flow in
-- the app today; when one is built, it must be a SECURITY DEFINER RPC
-- that validates a server-issued invite token, not a raw client INSERT
-- policy on this table.
DROP POLICY IF EXISTS "tenant_members_insert_self" ON tenant_members;

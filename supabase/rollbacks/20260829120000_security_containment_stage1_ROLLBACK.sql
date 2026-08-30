-- ============================================================
-- ROLLBACK for 20260829120000_security_containment_stage1.sql
--
-- NOT part of the applied migration chain — intentionally kept outside
-- supabase/migrations/ so `supabase db push` never auto-applies it.
-- Apply manually only, via:
--   npx supabase db query --linked -f supabase/rollbacks/20260829120000_security_containment_stage1_ROLLBACK.sql
--
-- This restores the exact live policy set captured via a direct
-- `select * from pg_policies` query immediately before the forward
-- migration was written (2026-08-29). Restoring these policies
-- re-opens the anon-readable holes the forward migration closes — only
-- use this if the forward migration causes a legitimate-access
-- regression that needs to be undone while a proper fix is prepared.
-- Restoring anon access to app_settings in particular re-exposes
-- provider API keys; only do this knowingly.
-- ============================================================

-- ---- app_settings: restore original 7-policy set ----
DROP POLICY IF EXISTS "app_settings_authenticated_select" ON app_settings;
DROP POLICY IF EXISTS "app_settings_authenticated_insert" ON app_settings;
DROP POLICY IF EXISTS "app_settings_authenticated_update" ON app_settings;

CREATE POLICY "anon_delete_settings" ON app_settings FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_settings" ON app_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_select_settings" ON app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_update_settings" ON app_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "app_settings_authenticated_insert" ON app_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "app_settings_authenticated_select" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_authenticated_update" ON app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ---- conversations: restore original 7-policy set ----
DROP POLICY IF EXISTS "conversations_tenant_select" ON conversations;
DROP POLICY IF EXISTS "conversations_tenant_insert" ON conversations;
DROP POLICY IF EXISTS "conversations_tenant_update" ON conversations;

CREATE POLICY "anon_delete_conversations" ON conversations FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "conversations_tenant_insert" ON conversations FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "conversations_tenant_select" ON conversations FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "conversations_tenant_update" ON conversations FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- ---- messages: restore original 6-policy set ----
DROP POLICY IF EXISTS "messages_tenant_select" ON messages;
DROP POLICY IF EXISTS "messages_tenant_insert" ON messages;

CREATE POLICY "anon_delete_messages" ON messages FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_update_messages" ON messages FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "messages_tenant_insert" ON messages FOR INSERT TO authenticated WITH CHECK (
  conversation_id IN (SELECT id FROM conversations WHERE is_tenant_member(tenant_id))
);
CREATE POLICY "messages_tenant_select" ON messages FOR SELECT TO authenticated USING (
  conversation_id IN (SELECT id FROM conversations WHERE is_tenant_member(tenant_id))
);

-- ---- fact_revisions: restore original 3-policy set ----
DROP POLICY IF EXISTS "fact_revisions_authenticated_select" ON fact_revisions;

CREATE POLICY "anon_delete_fact_revisions" ON fact_revisions FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_fact_revisions" ON fact_revisions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_select_fact_revisions" ON fact_revisions FOR SELECT TO anon, authenticated USING (true);

-- ---- memory_settings: restore original 2-policy set ----
DROP POLICY IF EXISTS "memory_settings_authenticated_select" ON memory_settings;
DROP POLICY IF EXISTS "memory_settings_authenticated_update" ON memory_settings;

CREATE POLICY "anon_select_memory_settings" ON memory_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_update_memory_settings" ON memory_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ---- tenant_members: restore the open self-insert policy ----
-- WARNING: restores the tenant-escalation hole (S0-02). Only do this if
-- something legitimate broke and needs immediate restoration while a
-- proper fix ships.
CREATE POLICY "tenant_members_insert_self" ON tenant_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

/*
# V1 Corporate AI OS Foundation — Multi-Tenancy, Auth, Governance

## Purpose
This is the master V1 migration. It introduces real authentication-backed
multi-tenancy, an approval-gate mechanism, client packages/entitlements,
budget governance, a simulation flag for missions, an organizational
"lessons learned" store, and safe background task-queue claiming — while
reusing every existing table and writing pattern established in prior
migrations. Purely additive: no existing table is dropped, no existing
column is removed or retyped, no existing data is deleted.

## Tenant model
- `tenants` — one row per company using Temo. A single well-known row,
  id `00000000-0000-0000-0000-000000000001`, represents "Temo Corporate"
  itself (the owner's own internal operation — Section 13 of the V1
  mission: Temo running its own projects). All other tenants are client
  companies using the shared workforce.
- `tenant_members` — links `auth.users` to tenants with a role. A user can
  belong to multiple tenants (e.g. staff), but a normal client user
  belongs to exactly one.
- Existing data (every row created before this migration) is backfilled to
  the internal tenant, NOT deleted or orphaned — see the UPDATE statements
  below. Going forward, `tenant_id` is NOT NULL on tenant-scoped tables.

## Security model change (Section 7 of the V1 mission)
Every table that previously granted `anon, authenticated` full access is
tightened to `authenticated` only — the app now requires a real Supabase
Auth session for all data access. Service-role Edge Functions are
unaffected (they bypass RLS). Tenant-scoped tables additionally require
membership in the row's tenant via `is_tenant_member()`.

## Shared workforce, isolated data
`agent_registry` / `agent_departments` remain global and shared across all
tenants (Section 15: "do NOT create a separate physical AI agent instance
for every customer") — only DATA (missions, conversations, memories,
usage) is tenant-scoped, matching the mission's explicit instruction.
*/

-- ============================================================
-- 1. EXTENSIONS NEEDED FOR THE QUEUE (pg_cron / pg_net)
-- ============================================================
-- Both ship with Supabase Postgres. Wrapped defensively — if a project's
-- plan doesn't expose them, the rest of this migration still succeeds and
-- the queue simply falls back to on-request synchronous execution (the
-- existing, working behavior) until a schedule is manually configured.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_cron unavailable on this project — background queue scheduling must be configured manually (see docs/TEMO-ARCHITECTURE.md).';
END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_net unavailable on this project — the queue trigger Edge Function must be invoked by an external scheduler instead.';
END $$;

-- ============================================================
-- 2. TENANTS
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  kind        text NOT NULL DEFAULT 'client' CHECK (kind IN ('internal', 'client')),
  package_id  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenants (id, name, slug, kind)
VALUES ('00000000-0000-0000-0000-000000000001', 'Temo Corporate', 'temo-corporate', 'internal')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);

-- Helper used throughout RLS policies below.
CREATE OR REPLACE FUNCTION is_tenant_member(check_tenant_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE tenant_id = check_tenant_id AND user_id = auth.uid()
  );
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenants_select_members" ON tenants;
CREATE POLICY "tenants_select_members" ON tenants FOR SELECT
  TO authenticated USING (is_tenant_member(id));
DROP POLICY IF EXISTS "tenants_insert_self" ON tenants;
CREATE POLICY "tenants_insert_self" ON tenants FOR INSERT
  TO authenticated WITH CHECK (kind = 'client');
DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE
  TO authenticated USING (is_tenant_member(id)) WITH CHECK (is_tenant_member(id));

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_members_select_own" ON tenant_members;
CREATE POLICY "tenant_members_select_own" ON tenant_members FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "tenant_members_insert_self" ON tenant_members;
CREATE POLICY "tenant_members_insert_self" ON tenant_members FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 3. CLIENT PROFILE — AI Account Manager identity (Section 15)
-- ============================================================
-- Configuration, not a new agent: lets a client rename their assistant,
-- set language/preferences. Job titles/roles remain system-controlled
-- (unrelated to this table — see agent_registry).

CREATE TABLE IF NOT EXISTS client_profiles (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  assistant_name      text NOT NULL DEFAULT 'Temo',
  avatar              text,
  preferred_language  text NOT NULL DEFAULT 'en',
  preferences         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_profiles_select" ON client_profiles;
CREATE POLICY "client_profiles_select" ON client_profiles FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "client_profiles_upsert" ON client_profiles;
CREATE POLICY "client_profiles_insert" ON client_profiles FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "client_profiles_update" ON client_profiles;
CREATE POLICY "client_profiles_update" ON client_profiles FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

INSERT INTO client_profiles (tenant_id, assistant_name, preferred_language)
VALUES ('00000000-0000-0000-0000-000000000001', 'Temo', 'en')
ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================================
-- 4. PACKAGES / ENTITLEMENTS (Section 14)
-- ============================================================

CREATE TABLE IF NOT EXISTS packages (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  project_limit  integer,              -- NULL = unlimited (custom tier)
  credit_limit   integer,              -- NULL = unlimited
  features       jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_cents    integer,              -- NULL = not yet priced / custom
  sort_order     integer NOT NULL DEFAULT 0
);

INSERT INTO packages (id, name, project_limit, credit_limit, sort_order) VALUES
  ('free',     'Free / Trial', 1, 20,   0),
  ('package1', 'Package 1',    3, 100,  1),
  ('package2', 'Package 2',    3, 250,  2),
  ('package3', 'Package 3',   10, 1000, 3),
  ('custom',   'Custom',       NULL, NULL, 4)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, project_limit = EXCLUDED.project_limit,
  credit_limit = EXCLUDED.credit_limit, sort_order = EXCLUDED.sort_order;

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "packages_select_all" ON packages;
CREATE POLICY "packages_select_all" ON packages FOR SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  package_id      text NOT NULL REFERENCES packages(id) DEFAULT 'free',
  credits_remaining integer,
  projects_used   integer NOT NULL DEFAULT 0,
  period_start    date NOT NULL DEFAULT date_trunc('month', now())::date,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entitlements_select" ON tenant_entitlements;
CREATE POLICY "entitlements_select" ON tenant_entitlements FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "entitlements_insert" ON tenant_entitlements;
CREATE POLICY "entitlements_insert" ON tenant_entitlements FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "entitlements_update" ON tenant_entitlements;
CREATE POLICY "entitlements_update" ON tenant_entitlements FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

INSERT INTO tenant_entitlements (tenant_id, package_id, credits_remaining)
VALUES ('00000000-0000-0000-0000-000000000001', 'custom', NULL)
ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================================
-- 5. APPROVAL GATES (Section 8)
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  type          text NOT NULL,          -- e.g. 'tool_execution', 'spend', 'publish'
  title         text NOT NULL,
  detail        text NOT NULL DEFAULT '',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by  text NOT NULL,          -- agent id or 'system'
  mission_id    uuid REFERENCES missions(id) ON DELETE SET NULL,
  task_id       uuid REFERENCES mission_tasks(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_mission ON approval_requests(mission_id) WHERE mission_id IS NOT NULL;

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "approvals_select" ON approval_requests;
CREATE POLICY "approvals_select" ON approval_requests FOR SELECT
  TO authenticated USING (tenant_id IS NULL OR is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "approvals_insert" ON approval_requests;
CREATE POLICY "approvals_insert" ON approval_requests FOR INSERT
  TO authenticated WITH CHECK (tenant_id IS NULL OR is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "approvals_update" ON approval_requests;
CREATE POLICY "approvals_update" ON approval_requests FOR UPDATE
  TO authenticated USING (tenant_id IS NULL OR is_tenant_member(tenant_id))
  WITH CHECK (tenant_id IS NULL OR is_tenant_member(tenant_id));
-- No DELETE policy — approval history is append/update-only, never deleted.

-- ============================================================
-- 6. LESSONS LEARNED / ORGANIZATIONAL KNOWLEDGE (Section 11)
-- ============================================================

CREATE TABLE IF NOT EXISTS lessons_learned (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id  uuid REFERENCES missions(id) ON DELETE SET NULL,
  category    text NOT NULL DEFAULT 'general',
  summary     text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  outcome     text NOT NULL CHECK (outcome IN ('success', 'failure', 'partial')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lessons_learned_tenant ON lessons_learned(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_learned_category ON lessons_learned(category);

ALTER TABLE lessons_learned ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lessons_select" ON lessons_learned;
CREATE POLICY "lessons_select" ON lessons_learned FOR SELECT
  TO authenticated USING (tenant_id IS NULL OR is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "lessons_insert" ON lessons_learned;
CREATE POLICY "lessons_insert" ON lessons_learned FOR INSERT
  TO authenticated WITH CHECK (tenant_id IS NULL OR is_tenant_member(tenant_id));
-- No UPDATE/DELETE — lessons are append-only, same rationale as usage_ledger.

-- ============================================================
-- 7. BUDGET GOVERNANCE (extends usage_ledger, Section 9)
-- ============================================================

ALTER TABLE usage_ledger
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usage_ledger_tenant ON usage_ledger(tenant_id) WHERE tenant_id IS NOT NULL;

UPDATE usage_ledger SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS budgets (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_limit_usd     numeric(12,2),
  alert_threshold_pct   integer NOT NULL DEFAULT 80,
  current_period_start  date NOT NULL DEFAULT date_trunc('month', now())::date,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budgets_select" ON budgets;
CREATE POLICY "budgets_select" ON budgets FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "budgets_upsert" ON budgets;
CREATE POLICY "budgets_insert" ON budgets FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "budgets_update" ON budgets;
CREATE POLICY "budgets_update" ON budgets FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- Tighten usage_ledger from the Sprint 3 anon-open policies to authenticated-only.
DROP POLICY IF EXISTS "usage_ledger_select_all" ON usage_ledger;
CREATE POLICY "usage_ledger_select_all" ON usage_ledger FOR SELECT
  TO authenticated USING (tenant_id IS NULL OR is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "usage_ledger_insert_all" ON usage_ledger;
CREATE POLICY "usage_ledger_insert_all" ON usage_ledger FOR INSERT
  TO authenticated WITH CHECK (tenant_id IS NULL OR is_tenant_member(tenant_id));

-- ============================================================
-- 8. MISSION ENGINE: simulation flag + tenant scoping + queue locking
-- ============================================================

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false;

UPDATE missions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE missions ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_missions_tenant ON missions(tenant_id);

ALTER TABLE mission_tasks
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

CREATE INDEX IF NOT EXISTS idx_mission_tasks_ready_unlocked
  ON mission_tasks(status, locked_at) WHERE status = 'ready';

-- Re-scope missions/objectives/tasks/timeline RLS to tenant membership
-- (previously anon-open, single-tenant policies from the mission engine's
-- original migration).
DROP POLICY IF EXISTS "missions_select_all" ON missions;
DROP POLICY IF EXISTS "missions_insert_all" ON missions;
DROP POLICY IF EXISTS "missions_update_all" ON missions;
DROP POLICY IF EXISTS "missions_all_anon" ON missions;
CREATE POLICY "missions_select_tenant" ON missions FOR SELECT
  TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "missions_insert_tenant" ON missions FOR INSERT
  TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "missions_update_tenant" ON missions FOR UPDATE
  TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['mission_objectives', 'mission_tasks', 'mission_timeline']
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = tbl LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "%1$s_tenant_select" ON %1$I FOR SELECT TO authenticated USING (
         mission_id IN (SELECT id FROM missions WHERE is_tenant_member(tenant_id))
       )', tbl);
    EXECUTE format(
      'CREATE POLICY "%1$s_tenant_insert" ON %1$I FOR INSERT TO authenticated WITH CHECK (
         mission_id IN (SELECT id FROM missions WHERE is_tenant_member(tenant_id))
       )', tbl);
    EXECUTE format(
      'CREATE POLICY "%1$s_tenant_update" ON %1$I FOR UPDATE TO authenticated USING (
         mission_id IN (SELECT id FROM missions WHERE is_tenant_member(tenant_id))
       ) WITH CHECK (
         mission_id IN (SELECT id FROM missions WHERE is_tenant_member(tenant_id))
       )', tbl);
  END LOOP;
END $$;

-- ============================================================
-- 9. CONVERSATIONS / MESSAGES / MEMORIES: tenant scoping
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE conversations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE conversations ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);

ALTER TABLE memories ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE memories SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE memories ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_tenant ON memories(tenant_id);

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['conversations', 'messages', 'memories']
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = tbl LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY "conversations_tenant_select" ON conversations FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "conversations_tenant_insert" ON conversations FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "conversations_tenant_update" ON conversations FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "messages_tenant_select" ON messages FOR SELECT TO authenticated USING (
  conversation_id IN (SELECT id FROM conversations WHERE is_tenant_member(tenant_id))
);
CREATE POLICY "messages_tenant_insert" ON messages FOR INSERT TO authenticated WITH CHECK (
  conversation_id IN (SELECT id FROM conversations WHERE is_tenant_member(tenant_id))
);

CREATE POLICY "memories_tenant_select" ON memories FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "memories_tenant_insert" ON memories FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "memories_tenant_update" ON memories FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- memory_embeddings scopes through its parent memory row (no direct tenant_id
-- column — avoids denormalization drift for a table that's already keyed to
-- memories via memory_id).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'memory_embeddings' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON memory_embeddings', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "memory_embeddings_tenant_select" ON memory_embeddings FOR SELECT TO authenticated USING (
  memory_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
);
CREATE POLICY "memory_embeddings_tenant_insert" ON memory_embeddings FOR INSERT TO authenticated WITH CHECK (
  memory_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
);

-- ============================================================
-- 10. TIGHTEN REMAINING SHARED/GLOBAL TABLES: authenticated only
-- ============================================================
-- Shared workforce config (agent_registry, agent_departments) and other
-- system tables stay global/un-tenant-scoped by design (Section 15), but
-- must no longer be reachable by the anonymous role.
DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'app_settings', 'workflow_registry', 'agent_registry', 'agent_departments',
    'runtime_state', 'runtime_activity', 'structured_facts', 'memory_links',
    'memory_events'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
      -- Drop every existing policy unconditionally (not just anon-named
      -- ones) so no stale permissive policy can survive under a naming
      -- convention we didn't anticipate — see Section 7's "never weaken
      -- security" requirement.
      FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = tbl LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl);
      END LOOP;
      EXECUTE format('CREATE POLICY "%1$s_authenticated_select" ON %1$I FOR SELECT TO authenticated USING (true)', tbl);
      EXECUTE format('CREATE POLICY "%1$s_authenticated_insert" ON %1$I FOR INSERT TO authenticated WITH CHECK (true)', tbl);
      EXECUTE format('CREATE POLICY "%1$s_authenticated_update" ON %1$I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', tbl);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 11. AUTO-PROVISIONING TRIGGER (Section 15 — first user becomes the
--     internal owner; every subsequent signup gets their own client tenant)
-- ============================================================

CREATE OR REPLACE FUNCTION provision_tenant_for_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_tenant_id uuid;
  member_count integer;
BEGIN
  SELECT count(*) INTO member_count FROM tenant_members
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

  IF member_count = 0 THEN
    -- First user ever: becomes the internal Temo Corporate owner.
    INSERT INTO tenant_members (tenant_id, user_id, role)
    VALUES ('00000000-0000-0000-0000-000000000001', NEW.id, 'owner');
  ELSE
    -- Client signup: gets their own isolated tenant.
    INSERT INTO tenants (name, slug, kind)
    VALUES (
      COALESCE(NEW.raw_user_meta_data->>'company_name', split_part(NEW.email, '@', 1)),
      'client-' || substr(NEW.id::text, 1, 8),
      'client'
    )
    RETURNING id INTO new_tenant_id;

    INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (new_tenant_id, NEW.id, 'owner');
    INSERT INTO client_profiles (tenant_id, assistant_name, preferred_language)
    VALUES (new_tenant_id, 'Temo', COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'en'));
    INSERT INTO tenant_entitlements (tenant_id, package_id, credits_remaining)
    VALUES (new_tenant_id, 'free', 20);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_tenant ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_tenant
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION provision_tenant_for_new_user();

-- ============================================================
-- 12. QUEUE CLAIM FUNCTION — atomic "claim N ready tasks" for the
--     background processor (Section 5), safe under concurrent callers.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_ready_tasks(claim_limit integer DEFAULT 10, claimer text DEFAULT 'queue-worker')
RETURNS SETOF mission_tasks
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE mission_tasks
  SET locked_at = now(), locked_by = claimer
  WHERE id IN (
    SELECT id FROM mission_tasks
    WHERE status = 'ready' AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
    ORDER BY priority DESC, created_at ASC
    LIMIT claim_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

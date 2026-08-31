-- ============================================================
-- Milestone 5, Stage 2 — Governance (M5-13)
--
-- structured_facts, fact_revisions, memory_events, and runtime_activity
-- have no tenant scoping at all and leak across every tenant by
-- construction (Deep Integrity Audit, Section H1-e). This migration adds
-- real tenant_id columns, backfills, tightens the affected unique index,
-- and rewrites the SECURITY DEFINER RPC functions that touch
-- structured_facts to actually filter by tenant — SECURITY DEFINER
-- functions bypass RLS entirely, so tenant scoping has to be explicit
-- inside them, not left to the policy layer.
--
-- runtime_state is deliberately NOT touched here — see the COMMENT ON
-- TABLE at the bottom of this file for the reasoning.
-- ============================================================

-- ============================================================
-- 1. structured_facts — tenant_id column + unique index fix
-- ============================================================
-- The existing unique index (subject, predicate) is GLOBAL — two tenants
-- both storing a fact for the same (subject, predicate) pair (e.g. both
-- storing "user.name") would collide under the old index. Must become
-- (tenant_id, subject, predicate) in the same migration that adds the
-- column, or a live INSERT could hit the old constraint mid-rollout.

ALTER TABLE structured_facts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE structured_facts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE structured_facts ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS idx_structured_facts_subject_predicate_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_structured_facts_tenant_subject_predicate_active
  ON structured_facts (tenant_id, subject, predicate)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_structured_facts_tenant ON structured_facts (tenant_id);

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'structured_facts' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON structured_facts', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "structured_facts_tenant_select" ON structured_facts FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "structured_facts_tenant_insert" ON structured_facts FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "structured_facts_tenant_update" ON structured_facts FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "structured_facts_tenant_delete" ON structured_facts FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- ============================================================
-- 2. fact_revisions — tenant_id column, backfilled via parent fact
-- ============================================================

ALTER TABLE fact_revisions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE fact_revisions fr SET tenant_id = sf.tenant_id
  FROM structured_facts sf WHERE fr.fact_id = sf.id AND fr.tenant_id IS NULL;
-- Any orphaned revision (parent fact since hard-deleted) falls back to the internal tenant.
UPDATE fact_revisions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE fact_revisions ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fact_revisions_tenant ON fact_revisions (tenant_id);

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'fact_revisions' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON fact_revisions', pol.policyname);
  END LOOP;
END $$;
-- Append-only audit log — SELECT + INSERT only, matching usage_ledger's
-- pattern (no UPDATE/DELETE policy at all).
CREATE POLICY "fact_revisions_tenant_select" ON fact_revisions FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "fact_revisions_tenant_insert" ON fact_revisions FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));

-- ============================================================
-- 3. memory_events — tenant_id column
-- ============================================================
-- lib/memory/episodicMemory.ts's recordWithMemory() already accepts a
-- tenantId parameter (used for the linked `memories` row) but never
-- threaded it into this table's own insert — a real gap, not just a
-- missing column, closed in the same app-code change as this migration.

ALTER TABLE memory_events ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE memory_events me SET tenant_id = m.tenant_id
  FROM memories m WHERE me.memory_id = m.id AND me.tenant_id IS NULL;
UPDATE memory_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE memory_events ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_events_tenant ON memory_events (tenant_id);

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'memory_events' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON memory_events', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "memory_events_tenant_select" ON memory_events FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "memory_events_tenant_insert" ON memory_events FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "memory_events_tenant_delete" ON memory_events FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- ============================================================
-- 4. runtime_activity — tenant_id column, DB-trigger-derived
-- ============================================================
-- Deliberately NOT threaded through application code (21+ call sites
-- across lib/swarm and lib/crew emit runtime events) — a trigger that
-- derives tenant_id from the already-present mission_id column at
-- INSERT time is more robust than relying on every current and future
-- caller remembering to pass it explicitly, and produces the exact same
-- result: events tied to a mission inherit that mission's tenant; the
-- documented generic system-wide events (mission_id IS NULL) stay
-- tenant_id NULL, matching runtimeStore.ts's existing comment that
-- those "carry no tenant-specific content to begin with."

ALTER TABLE runtime_activity ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION derive_runtime_activity_tenant()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mission_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM missions WHERE id = NEW.mission_id::uuid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_runtime_activity_tenant ON runtime_activity;
CREATE TRIGGER trg_runtime_activity_tenant BEFORE INSERT ON runtime_activity
  FOR EACH ROW EXECUTE FUNCTION derive_runtime_activity_tenant();

-- Backfill existing rows through the same derivation.
UPDATE runtime_activity ra SET tenant_id = m.tenant_id
  FROM missions m WHERE ra.mission_id = m.id::text AND ra.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_runtime_activity_tenant ON runtime_activity (tenant_id);

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'runtime_activity' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON runtime_activity', pol.policyname);
  END LOOP;
END $$;
-- tenant_id IS NULL (generic system events) stays visible to every
-- authenticated user by design, matching the pre-existing app-level
-- redaction in getRuntimeActivityForTenant() this replaces/hardens.
CREATE POLICY "runtime_activity_tenant_select" ON runtime_activity FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR is_tenant_member(tenant_id));
CREATE POLICY "runtime_activity_authenticated_insert" ON runtime_activity FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "runtime_activity_authenticated_delete" ON runtime_activity FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 5. RPC functions — SECURITY DEFINER bypasses RLS, so tenant
--    filtering must be explicit inside each function body.
-- ============================================================

DROP FUNCTION IF EXISTS upsert_structured_fact(text, text, text, fact_category, int, text, text, memory_importance, text[], uuid, jsonb);

CREATE OR REPLACE FUNCTION upsert_structured_fact(
  p_subject text,
  p_predicate text,
  p_object text,
  p_tenant_id uuid,
  p_category fact_category DEFAULT 'fact',
  p_confidence int DEFAULT 100,
  p_confidence_source text DEFAULT 'user',
  p_confidence_reason text DEFAULT NULL,
  p_importance memory_importance DEFAULT 'high',
  p_tags text[] DEFAULT '{}',
  p_semantic_memory_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  action text,
  fact_id uuid,
  conflict boolean,
  old_value text,
  old_fact_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
  existing_object text;
  existing_confidence int;
  new_id uuid;
BEGIN
  IF NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', p_tenant_id;
  END IF;

  SELECT id, object, confidence INTO existing_id, existing_object, existing_confidence
  FROM structured_facts
  WHERE subject = p_subject
    AND predicate = p_predicate
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND superseded_by IS NULL
  LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO structured_facts (
      subject, predicate, object, tenant_id, category, confidence,
      confidence_source, confidence_reason, importance, tags,
      semantic_memory_id, metadata
    ) VALUES (
      p_subject, p_predicate, p_object, p_tenant_id, p_category, p_confidence,
      p_confidence_source, p_confidence_reason, p_importance, p_tags,
      p_semantic_memory_id, p_metadata
    )
    RETURNING id INTO new_id;

    INSERT INTO fact_revisions (fact_id, tenant_id, revision_type, new_value, new_confidence, reason)
    VALUES (new_id, p_tenant_id, 'created', p_object, p_confidence, p_confidence_reason);

    RETURN QUERY SELECT 'created'::text, new_id, false, NULL::text, NULL::uuid;
  ELSIF existing_object = p_object THEN
    RETURN QUERY SELECT 'duplicate'::text, existing_id, false, existing_object, NULL::uuid;
  ELSE
    RETURN QUERY SELECT 'conflict'::text, existing_id, true, existing_object, existing_id;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS replace_structured_fact(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION replace_structured_fact(
  p_old_fact_id uuid,
  p_new_object text,
  p_reason text DEFAULT NULL,
  p_new_confidence int DEFAULT NULL,
  p_new_confidence_reason text DEFAULT NULL
)
RETURNS TABLE (new_fact_id uuid, old_fact_id uuid, new_version int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_record RECORD;
  new_id uuid;
  new_version int;
  new_conf int;
BEGIN
  SELECT * INTO old_record FROM structured_facts WHERE id = p_old_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fact % not found', p_old_fact_id;
  END IF;

  IF NOT is_tenant_member(old_record.tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', old_record.tenant_id;
  END IF;

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  UPDATE structured_facts SET deleted_at = now() WHERE id = p_old_fact_id;

  -- old_record.tenant_id carries forward — a replacement never changes
  -- which tenant owns the fact.
  INSERT INTO structured_facts (
    subject, predicate, object, tenant_id, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.tenant_id, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  UPDATE structured_facts
  SET superseded_by = new_id, deleted_at = NULL
  WHERE id = p_old_fact_id;

  INSERT INTO fact_revisions (fact_id, tenant_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, old_record.tenant_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;

DROP FUNCTION IF EXISTS match_structured_facts(text, text, fact_category[], text, int);

CREATE OR REPLACE FUNCTION match_structured_facts(
  p_tenant_id uuid,
  p_subject text DEFAULT NULL,
  p_predicate text DEFAULT NULL,
  p_categories fact_category[] DEFAULT NULL,
  p_search_text text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  confidence_source text,
  confidence_reason text,
  verified boolean,
  importance memory_importance,
  tags text[],
  semantic_memory_id uuid,
  metadata jsonb,
  superseded_by uuid,
  version int,
  previous_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', p_tenant_id;
  END IF;

  IF p_subject IS NOT NULL AND p_predicate IS NOT NULL THEN
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.predicate = p_predicate
      AND sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
    LIMIT 1;
  ELSIF p_subject IS NOT NULL THEN
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSIF p_search_text IS NOT NULL THEN
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE (sf.object ILIKE '%' || p_search_text || '%'
           OR sf.predicate ILIKE '%' || p_search_text || '%')
      AND sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS get_fact_history(text, text);

CREATE OR REPLACE FUNCTION get_fact_history(
  p_subject text,
  p_predicate text,
  p_tenant_id uuid
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  version int,
  superseded_by uuid,
  previous_version_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', p_tenant_id;
  END IF;

  RETURN QUERY
  SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
         sf.confidence, sf.version, sf.superseded_by, sf.previous_version_id,
         sf.created_at
  FROM structured_facts sf
  WHERE sf.subject = p_subject
    AND sf.predicate = p_predicate
    AND sf.tenant_id = p_tenant_id
    AND sf.deleted_at IS NULL
  ORDER BY sf.version ASC;
END;
$$;

-- ============================================================
-- 6. runtime_state — explicitly NOT scoped; documented reasoning
-- ============================================================
-- runtime_state is a genuine single-row global singleton (id='default',
-- lib/swarm/runtimeStore.ts:240-243) tracking "the mission currently
-- executing" system-wide. A tenant_id column on a one-row table cannot
-- express per-tenant state — it would sit there as a single value
-- regardless of which tenant's mission is actually running, which is
-- not real isolation, just a column that doesn't get used (the anti-
-- pattern this ticket explicitly says to avoid). The real fix is
-- architectural — one row per tenant instead of a hardcoded 'default'
-- row — which is a genuine redesign of the execution engine's state
-- model, not a column addition, and was already explicitly flagged as
-- out of scope for the tenant-isolation pass this table already went
-- through (see this table's own code comment in runtimeStore.ts,
-- Section "Tenant-scoped views (M2-01)"). The existing mitigation
-- (getRuntimeStateForTenant() redacting mission-specific fields for a
-- caller who doesn't own the current mission) still applies and is
-- unchanged by this migration.
COMMENT ON TABLE runtime_state IS
  'M5-13: deliberately NOT tenant-scoped via a column — this is a single-row global singleton (id=''default''), and a column cannot express per-tenant state on one row. Real per-tenant isolation would require converting this to one row per tenant, an architectural change out of scope here. Content-level leakage is mitigated by lib/swarm/runtimeStore.ts''s getRuntimeStateForTenant(), which redacts mission-specific fields for a non-owning caller.';

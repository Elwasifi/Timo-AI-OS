/*
# Knowledge Engine Foundation — Phase 2

1. Purpose
   Creates the database schema for Timo AI OS's Knowledge Engine. This is the
   structured knowledge layer that sits above the existing semantic memory
   system. It stores facts as semantic triples (subject → predicate → object)
   with confidence, versioning, and conflict tracking. The Knowledge Engine
   becomes the single source of truth — all modules query through it, never
   touching database tables directly.

2. New Tables
   - `structured_facts` — facts stored as triples (subject, predicate, object)
     with category, confidence, versioning, and soft-delete. One active fact
     per (subject, predicate) pair enforced by a partial unique index.
   - `fact_revisions` — audit log of every change to a structured fact
     (created, updated, superseded, conflict_resolved, soft_deleted).

3. New Enums
   - `fact_category` — classifies knowledge type: preference, identity, project,
     configuration, environment, workflow, habit, decision, rule, goal,
     relationship, task, fact, history, temporary.

4. New Functions
   - `upsert_structured_fact(...)` — atomic insert-or-conflict detection.
     Returns action ('created', 'duplicate', 'conflict') with old/new values.
   - `replace_structured_fact(...)` — supersedes an old fact with a new version,
     creating the version chain and revision record.
   - `match_structured_facts(...)` — O(1) lookup by subject+predicate, or
     ILIKE search across object/predicate, with optional category filter.
   - `get_fact_history(...)` — returns all versions of a fact (including
     superseded) ordered by version number.

5. Bug Fix
   - Recreates `match_memories()` with vector(3072) signature. The original
     function (migration 20260727111830) used vector(768) but embeddings
     were upgraded to 3072 dimensions in migration 20260727112722. The
     function was never updated, causing semantic search to fail.

6. Security
   - RLS enabled on all new tables.
   - Single-tenant app (no sign-in) → anon + authenticated full CRUD.
   - All policies use TO anon, authenticated.

7. Important Notes
   - No existing tables are altered or dropped (except match_memories which
     is CREATE OR REPLACE).
   - The partial unique index on (subject, predicate) ensures only one active
     fact per pair — superseded facts retain their row but are excluded.
   - `superseded_by` and `previous_version_id` create a linked list of versions.
   - `semantic_memory_id` links a structured fact to its semantic memory
     counterpart in the `memories` table (nullable — not all facts have one).
*/
-- ---- Enum: fact_category ----
DO $$ BEGIN
  CREATE TYPE fact_category AS ENUM (
    'preference', 'identity', 'project', 'configuration', 'environment',
    'workflow', 'habit', 'decision', 'rule', 'goal', 'relationship',
    'task', 'fact', 'history', 'temporary'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Table: structured_facts ----
CREATE TABLE IF NOT EXISTS structured_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  predicate text NOT NULL,
  object text NOT NULL,
  category fact_category NOT NULL DEFAULT 'fact',
  confidence int NOT NULL DEFAULT 100,
  confidence_source text NOT NULL DEFAULT 'user',
  confidence_reason text,
  verified boolean NOT NULL DEFAULT true,
  importance memory_importance NOT NULL DEFAULT 'high',
  tags text[] NOT NULL DEFAULT '{}',
  semantic_memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  superseded_by uuid REFERENCES structured_facts(id) ON DELETE SET NULL,
  version int NOT NULL DEFAULT 1,
  previous_version_id uuid REFERENCES structured_facts(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active fact per (subject, predicate) — superseded and deleted rows excluded
CREATE UNIQUE INDEX IF NOT EXISTS idx_structured_facts_subject_predicate_active
  ON structured_facts (subject, predicate)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_structured_facts_subject ON structured_facts (subject);
CREATE INDEX IF NOT EXISTS idx_structured_facts_predicate ON structured_facts (predicate);
CREATE INDEX IF NOT EXISTS idx_structured_facts_category ON structured_facts (category);
CREATE INDEX IF NOT EXISTS idx_structured_facts_object ON structured_facts (object);
CREATE INDEX IF NOT EXISTS idx_structured_facts_semantic_memory ON structured_facts (semantic_memory_id);
CREATE INDEX IF NOT EXISTS idx_structured_facts_tags ON structured_facts USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_structured_facts_created_at ON structured_facts (created_at desc);

ALTER TABLE structured_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_structured_facts" ON structured_facts;
CREATE POLICY "anon_select_structured_facts" ON structured_facts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_structured_facts" ON structured_facts;
CREATE POLICY "anon_insert_structured_facts" ON structured_facts FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_structured_facts" ON structured_facts;
CREATE POLICY "anon_update_structured_facts" ON structured_facts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_structured_facts" ON structured_facts;
CREATE POLICY "anon_delete_structured_facts" ON structured_facts FOR DELETE
  TO anon, authenticated USING (true);

-- ---- Table: fact_revisions ----
CREATE TABLE IF NOT EXISTS fact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id uuid NOT NULL REFERENCES structured_facts(id) ON DELETE CASCADE,
  revision_type text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  old_confidence int,
  new_confidence int,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fact_revisions_fact_id ON fact_revisions (fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_revisions_type ON fact_revisions (revision_type);
CREATE INDEX IF NOT EXISTS idx_fact_revisions_created_at ON fact_revisions (created_at desc);

ALTER TABLE fact_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_fact_revisions" ON fact_revisions;
CREATE POLICY "anon_select_fact_revisions" ON fact_revisions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_fact_revisions" ON fact_revisions;
CREATE POLICY "anon_insert_fact_revisions" ON fact_revisions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_fact_revisions" ON fact_revisions;
CREATE POLICY "anon_delete_fact_revisions" ON fact_revisions FOR DELETE
  TO anon, authenticated USING (true);

-- ---- Auto-update updated_at on structured_facts ----
CREATE OR REPLACE FUNCTION update_structured_fact_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_structured_facts_updated_at ON structured_facts;
CREATE TRIGGER trg_structured_facts_updated_at BEFORE UPDATE ON structured_facts
  FOR EACH ROW EXECUTE FUNCTION update_structured_fact_updated_at();

-- ---- Function: upsert_structured_fact ----
-- Atomic insert-or-conflict detection. Returns the action taken.
CREATE OR REPLACE FUNCTION upsert_structured_fact(
  p_subject text,
  p_predicate text,
  p_object text,
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
  -- Find the active fact for this (subject, predicate)
  SELECT id, object, confidence INTO existing_id, existing_object, existing_confidence
  FROM structured_facts
  WHERE subject = p_subject
    AND predicate = p_predicate
    AND deleted_at IS NULL
    AND superseded_by IS NULL
  LIMIT 1;

  IF existing_id IS NULL THEN
    -- No existing fact → create new
    INSERT INTO structured_facts (
      subject, predicate, object, category, confidence,
      confidence_source, confidence_reason, importance, tags,
      semantic_memory_id, metadata
    ) VALUES (
      p_subject, p_predicate, p_object, p_category, p_confidence,
      p_confidence_source, p_confidence_reason, p_importance, p_tags,
      p_semantic_memory_id, p_metadata
    )
    RETURNING id INTO new_id;

    INSERT INTO fact_revisions (fact_id, revision_type, new_value, new_confidence, reason)
    VALUES (new_id, 'created', p_object, p_confidence, p_confidence_reason);

    RETURN QUERY SELECT 'created'::text, new_id, false, NULL::text, NULL::uuid;
  ELSIF existing_object = p_object THEN
    -- Same value → duplicate, no change
    RETURN QUERY SELECT 'duplicate'::text, existing_id, false, existing_object, NULL::uuid;
  ELSE
    -- Different value → conflict (caller decides resolution)
    RETURN QUERY SELECT 'conflict'::text, existing_id, true, existing_object, existing_id;
  END IF;
END;
$$;

-- ---- Function: replace_structured_fact ----
-- Supersedes an old fact with a new version, creating the version chain.
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

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  -- Insert the new version
  INSERT INTO structured_facts (
    subject, predicate, object, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  -- Mark old fact as superseded
  UPDATE structured_facts
  SET superseded_by = new_id
  WHERE id = p_old_fact_id;

  -- Create revision record
  INSERT INTO fact_revisions (fact_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;

-- ---- Function: match_structured_facts ----
-- O(1) lookup by subject+predicate, or ILIKE search with category filter.
CREATE OR REPLACE FUNCTION match_structured_facts(
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
  IF p_subject IS NOT NULL AND p_predicate IS NOT NULL THEN
    -- O(1) direct lookup
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE subject = p_subject
      AND predicate = p_predicate
      AND deleted_at IS NULL
      AND superseded_by IS NULL
    LIMIT 1;
  ELSIF p_subject IS NOT NULL THEN
    -- All active facts for a subject
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE subject = p_subject
      AND deleted_at IS NULL
      AND superseded_by IS NULL
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY created_at DESC
    LIMIT p_limit;
  ELSIF p_search_text IS NOT NULL THEN
    -- ILIKE search across object and predicate
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE (object ILIKE '%' || p_search_text || '%'
           OR predicate ILIKE '%' || p_search_text || '%')
      AND deleted_at IS NULL
      AND superseded_by IS NULL
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY created_at DESC
    LIMIT p_limit;
  ELSE
    -- Browse all active facts
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE deleted_at IS NULL
      AND superseded_by IS NULL
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

-- ---- Function: get_fact_history ----
-- Returns all versions of a fact (including superseded) ordered by version.
CREATE OR REPLACE FUNCTION get_fact_history(
  p_subject text,
  p_predicate text
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
  RETURN QUERY
  SELECT id, subject, predicate, object, category, confidence, version,
         superseded_by, previous_version_id, created_at
  FROM structured_facts
  WHERE subject = p_subject
    AND predicate = p_predicate
    AND deleted_at IS NULL
  ORDER BY version ASC;
END;
$$;

-- ---- Bug Fix: Recreate match_memories with vector(3072) ----
-- The original function used vector(768) but embeddings were upgraded to
-- 3072 dimensions. This fixes semantic search.
DROP FUNCTION IF EXISTS match_memories(vector, int, text, text, float);
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(3072),
  match_count int DEFAULT 5,
  filter_type text DEFAULT NULL,
  filter_agent text DEFAULT NULL,
  threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid, type memory_type, title text, content text, summary text,
  tags text[], importance memory_importance, importance_score int,
  source text, agent text, tool text, project text, metadata jsonb,
  expires_at timestamptz, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, similarity float
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.type, m.title, m.content, m.summary, m.tags, m.importance,
    m.importance_score, m.source, m.agent, m.tool, m.project, m.metadata,
    m.expires_at, m.deleted_at, m.created_at, m.updated_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM memory_embeddings e
  JOIN memories m ON m.id = e.memory_id
  WHERE m.deleted_at IS NULL
    AND (filter_type IS NULL OR m.type::text = filter_type)
    AND (filter_agent IS NULL OR m.agent = filter_agent)
    AND 1 - (e.embedding <=> query_embedding) >= threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
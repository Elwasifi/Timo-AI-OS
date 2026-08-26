/*
# Memory + RAG Foundation — Phase 4

1. Purpose
   Creates the complete database schema for Temo's Memory Engine. This is the
   foundation of Temo's intelligence — a unified memory system that stores,
   retrieves, and links memories across all agents using pgvector for semantic
   search.

2. New Tables
   - `memories` — the core memory table. Each row is a single memory record
     with type, content, importance, tags, agent, tool, project, and soft-delete.
   - `memory_embeddings` — vector embeddings for semantic search (pgvector).
   - `memory_links` — knowledge graph edges between memories.
   - `memory_events` — episodic memory timeline events.
   - `memory_settings` — configurable memory engine parameters.

3. Extensions
   - Enables `pgvector` extension for vector similarity search.

4. Security
   - RLS enabled on all tables.
   - Single-tenant app (no sign-in) → anon + authenticated full CRUD.
   - Soft delete via `deleted_at` column on `memories`.

5. Important Notes
   - The `memories.embedding` column is NOT stored inline — embeddings live in
     `memory_embeddings` to keep the core table lean.
   - `importance` is an enum: critical, high, medium, low, temporary.
   - `memory_type` is an enum: short_term, long_term, episodic, semantic.
   - All timestamps are timestamptz with defaults.
*/

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Importance levels
DO $$ BEGIN
  CREATE TYPE memory_importance AS ENUM ('critical', 'high', 'medium', 'low', 'temporary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Memory types
DO $$ BEGIN
  CREATE TYPE memory_type AS ENUM ('short_term', 'long_term', 'episodic', 'semantic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Link relationship types
DO $$ BEGIN
  CREATE TYPE memory_link_type AS ENUM ('relates_to', 'caused_by', 'part_of', 'derived_from', 'replaced_by', 'supports', 'contradicts');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Core memories table
CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type memory_type NOT NULL DEFAULT 'long_term',
  title text NOT NULL,
  content text NOT NULL,
  summary text,
  tags text[] NOT NULL DEFAULT '{}',
  importance memory_importance NOT NULL DEFAULT 'medium',
  importance_score int NOT NULL DEFAULT 50,
  source text,
  agent text,
  tool text,
  project text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories (importance);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories (agent);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories (project);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories (created_at desc);
CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories (deleted_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories (expires_at);

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memories" ON memories;
CREATE POLICY "anon_select_memories" ON memories FOR SELECT
  TO anon, authenticated USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "anon_insert_memories" ON memories;
CREATE POLICY "anon_insert_memories" ON memories FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_memories" ON memories;
CREATE POLICY "anon_update_memories" ON memories FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memories" ON memories;
CREATE POLICY "anon_delete_memories" ON memories FOR DELETE
  TO anon, authenticated USING (true);

-- Embeddings table (separate for performance)
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  embedding vector(768),
  model text,
  provider text,
  chunk_index int NOT NULL DEFAULT 0,
  chunk_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id ON memory_embeddings (memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings (model);

-- Vector similarity index (IVFFlat for production-scale search)
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_vector
  ON memory_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_select_memory_embeddings" ON memory_embeddings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_insert_memory_embeddings" ON memory_embeddings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_update_memory_embeddings" ON memory_embeddings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_delete_memory_embeddings" ON memory_embeddings FOR DELETE
  TO anon, authenticated USING (true);

-- Knowledge graph links
CREATE TABLE IF NOT EXISTS memory_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  link_type memory_link_type NOT NULL DEFAULT 'relates_to',
  weight float NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links (source_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links (target_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_type ON memory_links (link_type);

ALTER TABLE memory_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_links" ON memory_links;
CREATE POLICY "anon_select_memory_links" ON memory_links FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_links" ON memory_links;
CREATE POLICY "anon_insert_memory_links" ON memory_links FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_links" ON memory_links;
CREATE POLICY "anon_delete_memory_links" ON memory_links FOR DELETE
  TO anon, authenticated USING (true);

-- Episodic events timeline
CREATE TABLE IF NOT EXISTS memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_title text NOT NULL,
  event_detail text,
  agent text,
  project text,
  severity text NOT NULL DEFAULT 'info',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events (event_type);
CREATE INDEX IF NOT EXISTS idx_memory_events_agent ON memory_events (agent);
CREATE INDEX IF NOT EXISTS idx_memory_events_created_at ON memory_events (created_at desc);

ALTER TABLE memory_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_events" ON memory_events;
CREATE POLICY "anon_select_memory_events" ON memory_events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_events" ON memory_events;
CREATE POLICY "anon_insert_memory_events" ON memory_events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_events" ON memory_events;
CREATE POLICY "anon_delete_memory_events" ON memory_events FOR DELETE
  TO anon, authenticated USING (true);

-- Memory settings (single row, id=1)
CREATE TABLE IF NOT EXISTS memory_settings (
  id int PRIMARY KEY DEFAULT 1,
  embedding_provider text NOT NULL DEFAULT 'gemini',
  embedding_model text NOT NULL DEFAULT 'text-embedding-004',
  chunk_size int NOT NULL DEFAULT 512,
  chunk_overlap int NOT NULL DEFAULT 50,
  top_k int NOT NULL DEFAULT 5,
  similarity_threshold float NOT NULL DEFAULT 0.7,
  auto_remember boolean NOT NULL DEFAULT true,
  auto_summarize boolean NOT NULL DEFAULT true,
  memory_expiration_days int NOT NULL DEFAULT 30,
  max_short_term_items int NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO memory_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE memory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_settings" ON memory_settings;
CREATE POLICY "anon_select_memory_settings" ON memory_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_memory_settings" ON memory_settings;
CREATE POLICY "anon_update_memory_settings" ON memory_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- Auto-update updated_at on memories
CREATE OR REPLACE FUNCTION update_memory_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_updated_at ON memories;
CREATE TRIGGER trg_memories_updated_at BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_memory_updated_at();

-- Function to clean expired short-term memories
CREATE OR REPLACE FUNCTION clean_expired_memories()
RETURNS int AS $$
DECLARE
  deleted_count int;
BEGIN
  UPDATE memories SET deleted_at = now()
    WHERE expires_at IS NOT NULL
      AND expires_at < now()
      AND deleted_at IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

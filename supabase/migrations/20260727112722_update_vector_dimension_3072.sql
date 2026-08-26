/*
# Update vector dimension to 3072 for Gemini embeddings

Gemini's gemini-embedding-001 model produces 3072-dimensional vectors.
Uses HNSW index instead of IVFFlat (which has a 2000-dimension limit).
*/

DROP INDEX IF EXISTS idx_memory_embeddings_vector;
DROP TABLE IF EXISTS memory_embeddings;

CREATE TABLE memory_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  embedding vector(3072),
  model text,
  provider text,
  chunk_index int NOT NULL DEFAULT 0,
  chunk_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id ON memory_embeddings (memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings (model);

-- pgvector caps BOTH ivfflat and hnsw indexes at 2000 dimensions
-- (see https://github.com/pgvector/pgvector#indexing — "Indexes support up
-- to 2,000 dimensions"). vector(3072) categorically cannot be indexed by
-- either method today, so no index is created here — match_memories()
-- falls back to an exact sequential scan (`ORDER BY embedding <=> ...`),
-- which is correct and fast enough at this project's current scale.
-- Do not re-attempt an ANN index on this column until pgvector raises the
-- dimension cap, or until embeddings are stored at <=2000 dimensions.

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

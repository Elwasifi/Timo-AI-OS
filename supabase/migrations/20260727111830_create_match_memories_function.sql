/*
# Create match_memories function for semantic search

1. Purpose
   RPC function used by the memoryStore.semanticSearch() to find memories
   by vector similarity (cosine distance). Filters by type, agent, and
   similarity threshold.

2. Functions
   - `match_memories(query_embedding vector, match_count int, filter_type text, filter_agent text, threshold float)`
     Returns memory records with a `similarity` column (1 - cosine_distance).

3. Security
   - Function is SECURITY DEFINER so it can access the vector index.
   - Only returns non-deleted memories.
*/

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  filter_type text DEFAULT NULL,
  filter_agent text DEFAULT NULL,
  threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  type memory_type,
  title text,
  content text,
  summary text,
  tags text[],
  importance memory_importance,
  importance_score int,
  source text,
  agent text,
  tool text,
  project text,
  metadata jsonb,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.type,
    m.title,
    m.content,
    m.summary,
    m.tags,
    m.importance,
    m.importance_score,
    m.source,
    m.agent,
    m.tool,
    m.project,
    m.metadata,
    m.expires_at,
    m.deleted_at,
    m.created_at,
    m.updated_at,
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

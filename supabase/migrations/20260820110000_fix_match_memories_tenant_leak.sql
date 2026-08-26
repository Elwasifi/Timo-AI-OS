/*
# Fix match_memories() cross-tenant data leak (Section 3B security audit)

match_memories() (supabase/migrations/20260727112722_update_vector_dimension_3072.sql)
is SECURITY DEFINER with no tenant filter — it bypasses RLS entirely (that's
what SECURITY DEFINER means) and joins memory_embeddings to memories with no
tenant_id predicate. Since the V1 migration made memories.tenant_id NOT NULL
and scoped RLS to tenant membership (20260819140000), this function is now
the one remaining path where any authenticated user's semantic memory search
returns EVERY tenant's matching memories, not just their own — RLS is
correctly configured on the table but this function routes around it.

Fix: add a required filter_tenant_id parameter and filter on it. Made
required (no default) so no caller can silently omit it and fall back to an
unscoped scan — every call site must decide which tenant it's searching.

IMPORTANT: Postgres identifies functions by name + argument TYPE list, not
by name alone. Inserting filter_tenant_id changes the type signature, so
CREATE OR REPLACE FUNCTION alone would create a second, ADDITIONAL
overload — leaving the original unscoped 5-argument version callable
alongside it and defeating the fix entirely. The old signature must be
dropped explicitly first. Safe/idempotent: IF EXISTS guards a re-run.
*/

DROP FUNCTION IF EXISTS match_memories(vector, integer, text, text, double precision);

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(3072),
  filter_tenant_id uuid,
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
    AND m.tenant_id = filter_tenant_id
    AND (filter_type IS NULL OR m.type::text = filter_type)
    AND (filter_agent IS NULL OR m.agent = filter_agent)
    AND 1 - (e.embedding <=> query_embedding) >= threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

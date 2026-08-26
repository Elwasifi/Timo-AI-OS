/*
# Pending migrations — apply via Supabase Dashboard → SQL Editor → New query

Two migrations are written and typechecked but not yet applied to the live
database (confirmed live via a direct RPC probe against match_memories() —
the old, unscoped signature is still the only one that responds). Paste
this whole file into one SQL Editor query and run it once. Both statements
are additive/idempotent — safe to run more than once if needed.

Source files (identical content, for reference):
  supabase/migrations/20260820100000_reclaim_stale_running_tasks.sql
  supabase/migrations/20260820110000_fix_match_memories_tenant_leak.sql

No table is dropped, no row is deleted, no existing data is touched.
*/

-- ============================================================
-- 1) Reclaim tasks abandoned in 'running' status
-- ============================================================

CREATE OR REPLACE FUNCTION claim_ready_tasks(claim_limit integer DEFAULT 10, claimer text DEFAULT 'queue-worker')
RETURNS SETOF mission_tasks
LANGUAGE plpgsql AS $$
BEGIN
  -- Sweep abandoned 'running' tasks first (crashed executor recovery).
  UPDATE mission_tasks
  SET status = 'ready', locked_at = NULL, locked_by = NULL,
      retries = retries + 1, updated_at = now()
  WHERE status = 'running'
    AND updated_at < now() - interval '10 minutes'
    AND retries < max_retries;

  UPDATE mission_tasks
  SET status = 'failed',
      error_message = 'Abandoned: task stayed running past its retry limit with no completion (likely a crashed executor).',
      completed_at = now(),
      updated_at = now()
  WHERE status = 'running'
    AND updated_at < now() - interval '10 minutes'
    AND retries >= max_retries;

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

-- ============================================================
-- 2) Fix match_memories() cross-tenant leak
-- ============================================================
-- The old 5-argument signature must be dropped explicitly, not just
-- replaced — Postgres treats a changed argument list as a NEW overload,
-- which would leave the unscoped version callable side-by-side with the
-- fixed one and silently defeat the fix.

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

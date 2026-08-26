/*
# Reclaim stale 'running' tasks (Section 3D — Task Queue reliability)

claim_ready_tasks() already reclaims stale 'ready' locks (locked_at older
than 5 minutes). It never reclaimed tasks stuck in 'running' — if the
process executing a task crashes or is killed between claimTask() setting
status='running' and the task reaching a terminal status, that task stays
'running' forever with no automatic recovery ("abandoned locks" from the
Master Completion mission's Section 3D).

This migration extends claim_ready_tasks() to, before claiming new 'ready'
tasks, sweep 'running' tasks whose updated_at is older than 10 minutes:
  - if retries < max_retries: bump retries, reset to 'ready' so it gets
    picked up again (by either the queue processor or the synchronous
    pipeline's claimTask()).
  - otherwise: mark 'failed' with an explanatory error_message, so it
    doesn't loop forever ("infinite retries" from the same section).

Purely additive: CREATE OR REPLACE on an existing function, no schema
change beyond what 20260819140000 already added (locked_at/locked_by).
Idempotent and safe to re-run.
*/

CREATE OR REPLACE FUNCTION claim_ready_tasks(claim_limit integer DEFAULT 10, claimer text DEFAULT 'queue-worker')
RETURNS SETOF mission_tasks
LANGUAGE plpgsql AS $$
BEGIN
  -- Sweep abandoned 'running' tasks first (see migration header).
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

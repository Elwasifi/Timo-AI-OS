-- Fix: tasks stuck at status='running' are never recovered.
--
-- claim_ready_tasks() (20260819140000, Section 12) only reclaims tasks with
-- status='ready' whose locked_at is stale — that path works correctly (live
-- two-state test confirmed it). But lib/swarm/missionService.ts's
-- claimTask() moves a task to status='running' the moment execution starts
-- (UPDATE ... SET status='running' WHERE status IN ('ready','waiting')),
-- and nothing anywhere ever moves a 'running' task back out of that state
-- except the same request finishing normally. If the process crashes or is
-- restarted mid-execution (after claimTask() succeeds but before
-- executeTask() reaches a terminal status update), that task stays
-- status='running' forever: claim_ready_tasks() only looks at status='ready',
-- so it can never be picked up again by any future queue run or synchronous
-- call, and its parent mission's progress never completes. Confirmed live via
-- a synthetic stuck-'running' task: claim_ready_tasks() did not reclaim it,
-- while a stale-locked 'ready' task in the same test was reclaimed correctly.
--
-- Fix: before claiming 'ready' tasks, reset any 'running' task whose
-- started_at is old enough that it can't still be a legitimate in-flight
-- attempt back to 'ready' (clearing its lock), so it becomes eligible for
-- the existing reclaim query in the same call. 10 minutes comfortably
-- exceeds the in-process retry loop's worst case (executionLayer.ts:
-- maxRetries+1 attempts, each up to a 30s task timeout plus capped
-- exponential backoff) — a task still 'running' past that is abandoned, not
-- legitimately in progress. Extends the existing function rather than
-- introducing a second queue/sweeper mechanism.

CREATE OR REPLACE FUNCTION claim_ready_tasks(claim_limit integer DEFAULT 10, claimer text DEFAULT 'queue-worker')
RETURNS SETOF mission_tasks
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE mission_tasks
  SET status = 'ready', locked_at = NULL, locked_by = NULL
  WHERE status = 'running' AND started_at IS NOT NULL AND started_at < now() - interval '10 minutes';

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

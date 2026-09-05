-- M7-04: General confirmation/approval gate.
--
-- A mission task whose agent loop hits a tool call flagged
-- requiresApproval must pause (not fail, not consume a retry) until a
-- human resolves the pending approval_requests row. Adds the missing
-- status value for that paused state — task_queue_status is a real
-- Postgres enum (same class of thing M7-03's bugfix, migration
-- 20260905090000, just fixed for mission_timeline_event; confirmed this
-- one's actual live values before writing this migration, not assumed).
--
-- Additive only, idempotent (IF NOT EXISTS). recalculateProgress()
-- (lib/swarm/missionEngine.ts) only counts 'completed'/'failed' toward a
-- mission's total — a task sitting at 'awaiting_approval' behaves like
-- any other non-terminal status (ready/running/waiting) for mission-level
-- progress, correctly keeping the mission non-terminal until the approval
-- is resolved. claim_ready_tasks() only claims 'ready' rows, so an
-- 'awaiting_approval' task is naturally excluded from the queue until an
-- approval decision flips it back to 'ready' to resume.

ALTER TYPE task_queue_status ADD VALUE IF NOT EXISTS 'awaiting_approval';

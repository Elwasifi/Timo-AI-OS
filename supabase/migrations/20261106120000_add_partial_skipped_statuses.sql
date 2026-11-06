-- M7-13c-2b-2a: the database states the mission outcome model already needs.
--
-- lib/swarm/missionOutcome.ts decides a mission's outcome as completed / partial / failed / cancelled and a task's
-- as succeeded / failed / skipped / cancelled / ..., but the database has no 'partial' mission status and no
-- 'skipped' task status, so a partial mission is stored as status 'completed' plus missions.metadata.outcome, and a
-- task that never ran has nowhere honest to go. This adds the missing labels:
--   mission_status          'partial'          (some tasks succeeded, some did not)
--   task_queue_status       'skipped'          (the task was never run because the mission ended / was abandoned)
--   mission_timeline_event  'mission_partial'  (terminal timeline event for a partial mission)
--   mission_timeline_event  'task_skipped'     (timeline event for a skipped task)
--
-- ADDITIVE and FORWARD-ONLY. Postgres cannot drop an enum value, so this cannot be undone by a later migration;
-- the labels are appended after the existing ones (existing sort order is untouched). Idempotent (IF NOT EXISTS).
--
-- THIS FILE ONLY ADDS THE LABELS. A newly added enum value cannot be used in the same transaction that adds it
-- (error 55P04), so nothing here — no INSERT/UPDATE, function, policy, index or default — references them.
-- Writers (recalculateProgress writing 'partial', open tasks becoming 'skipped') and every reader that enumerates
-- statuses switch in a LATER code release, after this migration is applied. Until then the new labels exist and
-- nothing writes them, so no existing row, query, index, policy or function changes behaviour.

ALTER TYPE mission_status ADD VALUE IF NOT EXISTS 'partial';
ALTER TYPE task_queue_status ADD VALUE IF NOT EXISTS 'skipped';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'mission_partial';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'task_skipped';

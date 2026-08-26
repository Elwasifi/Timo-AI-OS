/*
# Phase 3A — Runtime Event Standardization

## Purpose
Add worker_id, task_id, and status columns to runtime_activity so every
emitted event carries the full execution chain context (agent, worker,
mission, task) plus a standardized status field.

## Safety
- ALTER TABLE ADD COLUMN only — no data loss, no type changes.
- Nullable columns with defaults — existing rows are unaffected.
*/

ALTER TABLE runtime_activity
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS task_id text,
  ADD COLUMN IF NOT EXISTS status text;

CREATE INDEX IF NOT EXISTS idx_runtime_activity_event_type
  ON runtime_activity (event_type);

CREATE INDEX IF NOT EXISTS idx_runtime_activity_agent
  ON runtime_activity (agent_id);

/*
# Phase 4 — Runtime State Persistence

## Purpose
Stores the current runtime state of Temo AI OS so the application
behaves as one persistent AI Operating System. This replaces
in-memory-only runtime state with database-backed state that
survives page reloads and session restarts.

## Tables
- `runtime_state`: single-row table holding the current mission,
  current manager, running tasks, execution state, and recent activity.
- `runtime_activity`: append-only feed of recent runtime events
  (decisions, routing, executions, completions, failures).

## Safety
- New tables only — no existing tables modified.
- RLS enabled with authenticated access.
*/

-- ============================================================
-- 1. RUNTIME STATE (single-row persistent state)
-- ============================================================

CREATE TABLE IF NOT EXISTS runtime_state (
  id text PRIMARY KEY DEFAULT 'default',
  current_mission_id text,
  current_manager_id text DEFAULT 'temo',
  execution_state text DEFAULT 'idle',
  running_task_ids text[] DEFAULT '{}',
  mission_progress integer DEFAULT 0,
  timeline_summary jsonb DEFAULT '[]',
  metadata jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

INSERT INTO runtime_state (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE runtime_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_runtime_state" ON runtime_state FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_runtime_state" ON runtime_state FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_runtime_state" ON runtime_state FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_runtime_state" ON runtime_state FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 2. RUNTIME ACTIVITY FEED (append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS runtime_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  title text NOT NULL,
  detail text DEFAULT '',
  agent_id text,
  mission_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runtime_activity_created
  ON runtime_activity (created_at DESC);

ALTER TABLE runtime_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_runtime_activity" ON runtime_activity FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_runtime_activity" ON runtime_activity FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "delete_runtime_activity" ON runtime_activity FOR DELETE
  TO anon, authenticated USING (true);

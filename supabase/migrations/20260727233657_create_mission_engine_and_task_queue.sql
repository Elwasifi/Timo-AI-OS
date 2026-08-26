/*
# Phase 2 — Mission Engine + Task Queue + Trading Department

## Purpose
Creates the persistent backend for the Mission-Oriented AI Operating System.
Missions are decomposed into objectives, which are decomposed into tasks.
Tasks live in a database-backed queue and are dispatched to managers by the
Swarm Manager using capability matching — never hardcoded agent names.

Also registers a new Trading department with an inactive manager (Orion).

## New Tables

### 1. `missions`
Top-level mission objects created from user requests.
- id (uuid PK)
- title (text) — short human label
- objective (text) — the single concrete goal
- user_request (text) — original user input verbatim
- priority (enum: low/medium/high/critical, default medium)
- status (enum: pending/planning/ready/executing/reviewing/completed/failed/cancelled/paused, default pending)
- progress (int 0-100, default 0)
- estimated_complexity (enum: simple/medium/complex, default simple)
- estimated_tasks (int, default 1)
- parent_mission_id (uuid, self-ref FK, nullable) — for sub-missions
- metadata (jsonb) — extensibility bag (tags, analytics, learning data)
- created_at / updated_at — timestamps

### 2. `mission_objectives`
Decomposition layer between mission and tasks.
- id (uuid PK)
- mission_id (uuid FK → missions, cascade delete)
- title (text)
- required_capability (text) — e.g. 'code_review', 'workflow_design'
- estimated_effort (enum: low/medium/high)
- dependencies (jsonb) — array of objective IDs that must complete first
- status (enum: pending/ready/in_progress/completed/failed, default pending)
- sort_order (int)
- created_at / updated_at

### 3. `mission_tasks`
The persistent task queue. Each task is an executable unit assigned to a manager.
- id (uuid PK)
- mission_id (uuid FK → missions, cascade delete)
- objective_id (uuid FK → mission_objectives, cascade delete, nullable)
- parent_task_id (uuid self-ref FK, nullable) — for task decomposition
- assigned_manager (text, nullable) — agent_registry.id of the assigned manager
- assigned_worker (text, nullable) — agent_registry.id of a future worker
- required_capability (text) — the capability needed to execute this task
- title (text) — what to do
- description (text) — detailed instruction
- priority (enum: low/medium/high/critical, default medium)
- status (enum: waiting/ready/running/completed/failed/cancelled, default waiting)
- dependencies (jsonb) — array of task IDs that must complete first
- retries (int, default 0)
- max_retries (int, default 3)
- execution_log (jsonb, default []) — append-only log of execution events
- result (jsonb, nullable) — task output
- error_message (text, nullable)
- created_at / updated_at / started_at / completed_at

### 4. `mission_timeline`
Append-only event log tracking the full lifecycle of every mission.
- id (uuid PK)
- mission_id (uuid FK → missions, cascade delete)
- event_type (enum: mission_created, mission_planned, objectives_generated,
  tasks_created, task_assigned, task_started, task_completed, task_failed,
  mission_completed, mission_failed, mission_cancelled, mission_paused,
  mission_resumed, review_started, review_completed)
- entity_type (text, nullable) — 'mission' | 'objective' | 'task'
- entity_id (text, nullable) — ID of the related entity
- title (text) — human-readable event label
- detail (text) — additional context
- metadata (jsonb, default {})
- created_at (timestamptz, default now())

## New Seed Data
- Trading Department (id='trading', icon='LineChart', color='#F97316')
- Orion agent (id='orion', level='manager', department='trading', is_active=false)

## Security
- RLS enabled on all 4 new tables.
- Policies: anon + authenticated full CRUD (single-tenant, no-auth app —
  consistent with all other tables in this project).
- The `agent_registry` and `agent_departments` tables from Phase 1 are
  extended with new seed rows only — no schema changes.

## Extensibility Notes
1. `missions.parent_mission_id` supports sub-mission decomposition.
2. `mission_tasks.parent_task_id` supports task decomposition by managers.
3. `mission_tasks.assigned_worker` is nullable and unused now — ready for Phase 3.
4. `missions.metadata` is a jsonb bag for future analytics, learning, tags.
5. `mission_tasks.execution_log` is append-only jsonb for full audit trail.
6. `mission_timeline` captures every lifecycle event for the future dashboard.
7. The `status` enums include 'paused'/'cancelled' for future pause/resume.
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE mission_status AS ENUM (
    'pending', 'planning', 'ready', 'executing',
    'reviewing', 'completed', 'failed', 'cancelled', 'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_complexity AS ENUM ('simple', 'medium', 'complex');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE objective_status AS ENUM (
    'pending', 'ready', 'in_progress', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE objective_effort AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_queue_status AS ENUM (
    'waiting', 'ready', 'running', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_timeline_event AS ENUM (
    'mission_created', 'mission_planned', 'objectives_generated',
    'tasks_created', 'task_assigned', 'task_started', 'task_completed',
    'task_failed', 'mission_completed', 'mission_failed',
    'mission_cancelled', 'mission_paused', 'mission_resumed',
    'review_started', 'review_completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. MISSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS missions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL,
  objective            text NOT NULL,
  user_request         text NOT NULL,
  priority             mission_priority NOT NULL DEFAULT 'medium',
  status               mission_status NOT NULL DEFAULT 'pending',
  progress             integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  estimated_complexity mission_complexity NOT NULL DEFAULT 'simple',
  estimated_tasks      integer NOT NULL DEFAULT 1 CHECK (estimated_tasks >= 0),
  parent_mission_id    uuid REFERENCES missions(id) ON DELETE SET NULL,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_select_all" ON missions;
CREATE POLICY "mission_select_all" ON missions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "mission_insert_all" ON missions;
CREATE POLICY "mission_insert_all" ON missions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "mission_update_all" ON missions;
CREATE POLICY "mission_update_all" ON missions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "mission_delete_all" ON missions;
CREATE POLICY "mission_delete_all" ON missions FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_parent ON missions(parent_mission_id);
CREATE INDEX IF NOT EXISTS idx_missions_priority ON missions(priority);

-- ============================================================
-- 3. MISSION OBJECTIVES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS mission_objectives (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id          uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title               text NOT NULL,
  required_capability text NOT NULL,
  estimated_effort    objective_effort NOT NULL DEFAULT 'medium',
  dependencies        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              objective_status NOT NULL DEFAULT 'pending',
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mission_objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "obj_select_all" ON mission_objectives;
CREATE POLICY "obj_select_all" ON mission_objectives FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "obj_insert_all" ON mission_objectives;
CREATE POLICY "obj_insert_all" ON mission_objectives FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "obj_update_all" ON mission_objectives;
CREATE POLICY "obj_update_all" ON mission_objectives FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "obj_delete_all" ON mission_objectives;
CREATE POLICY "obj_delete_all" ON mission_objectives FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_objectives_mission ON mission_objectives(mission_id);
CREATE INDEX IF NOT EXISTS idx_objectives_status ON mission_objectives(status);

-- ============================================================
-- 4. MISSION TASKS TABLE (Persistent Task Queue)
-- ============================================================

CREATE TABLE IF NOT EXISTS mission_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id          uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  objective_id        uuid REFERENCES mission_objectives(id) ON DELETE CASCADE,
  parent_task_id      uuid REFERENCES mission_tasks(id) ON DELETE SET NULL,
  assigned_manager    text,
  assigned_worker     text,
  required_capability text NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  priority            mission_priority NOT NULL DEFAULT 'medium',
  status              task_queue_status NOT NULL DEFAULT 'waiting',
  dependencies        jsonb NOT NULL DEFAULT '[]'::jsonb,
  retries             integer NOT NULL DEFAULT 0,
  max_retries         integer NOT NULL DEFAULT 3,
  execution_log       jsonb NOT NULL DEFAULT '[]'::jsonb,
  result              jsonb,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

ALTER TABLE mission_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_select_all" ON mission_tasks;
CREATE POLICY "task_select_all" ON mission_tasks FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "task_insert_all" ON mission_tasks;
CREATE POLICY "task_insert_all" ON mission_tasks FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "task_update_all" ON mission_tasks;
CREATE POLICY "task_update_all" ON mission_tasks FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "task_delete_all" ON mission_tasks;
CREATE POLICY "task_delete_all" ON mission_tasks FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_tasks_mission ON mission_tasks(mission_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON mission_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_manager ON mission_tasks(assigned_manager);
CREATE INDEX IF NOT EXISTS idx_tasks_ready ON mission_tasks(status) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON mission_tasks(priority);

-- ============================================================
-- 5. MISSION TIMELINE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS mission_timeline (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  event_type  mission_timeline_event NOT NULL,
  entity_type text,
  entity_id   text,
  title       text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mission_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timeline_select_all" ON mission_timeline;
CREATE POLICY "timeline_select_all" ON mission_timeline FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "timeline_insert_all" ON mission_timeline;
CREATE POLICY "timeline_insert_all" ON mission_timeline FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "timeline_update_all" ON mission_timeline;
CREATE POLICY "timeline_update_all" ON mission_timeline FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "timeline_delete_all" ON mission_timeline;
CREATE POLICY "timeline_delete_all" ON mission_timeline FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_timeline_mission ON mission_timeline(mission_id);
CREATE INDEX IF NOT EXISTS idx_timeline_created ON mission_timeline(created_at);

-- ============================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_mission_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_missions_updated ON missions;
CREATE TRIGGER trg_missions_updated
  BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION update_mission_updated_at();

DROP TRIGGER IF EXISTS trg_objectives_updated ON mission_objectives;
CREATE TRIGGER trg_objectives_updated
  BEFORE UPDATE ON mission_objectives
  FOR EACH ROW EXECUTE FUNCTION update_mission_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated ON mission_tasks;
CREATE TRIGGER trg_tasks_updated
  BEFORE UPDATE ON mission_tasks
  FOR EACH ROW EXECUTE FUNCTION update_mission_updated_at();

-- ============================================================
-- 7. SEED: TRADING DEPARTMENT
-- ============================================================

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order) VALUES
  ('trading', 'Trading Department', 'Market analysis, trading strategy, and risk management.', 'LineChart', '#F97316', 6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 8. SEED: ORION — Trading Manager (Inactive)
-- ============================================================

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description,
  capabilities, permissions, avatar, theme_color, status,
  system_prompt_template, model, is_active, sort_order
) VALUES
  (
    'orion', 'Orion', 'Trading Manager', 'manager', 'trading',
    'Manages the Trading Department. Specializes in market analysis, trading strategy, risk management, and portfolio optimization. Currently inactive — will be activated in a future phase.',
    '["market_analysis","trading_strategy","risk_management","portfolio_optimization","technical_analysis","quantitative_modeling"]'::jsonb,
    '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'LineChart', '#F97316', 'offline',
    'specialist', 'Gemini 2.0 Flash', false, 6
  )
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  level = EXCLUDED.level,
  department_id = EXCLUDED.department_id,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  permissions = EXCLUDED.permissions,
  avatar = EXCLUDED.avatar,
  theme_color = EXCLUDED.theme_color,
  status = EXCLUDED.status,
  system_prompt_template = EXCLUDED.system_prompt_template,
  model = EXCLUDED.model,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

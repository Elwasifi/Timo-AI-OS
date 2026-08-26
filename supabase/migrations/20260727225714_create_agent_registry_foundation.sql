/*
# Agent Registry Foundation — Phase 1: Manager Architecture

## Purpose
Creates the database foundation for a scalable Agent Registry that supports
departments, manager-level agents, and future worker agents. This is Phase 1
of the Swarm Architecture — it does NOT implement the Swarm Manager, Task Queue,
or any execution logic. It only provides the persistent identity layer.

## New Tables

### 1. `agent_departments`
Stores department definitions. Each department has one manager and will
eventually hold multiple workers.
- `id` (text, PK) — immutable slug identifier (e.g. 'engineering')
- `name` (text) — display name (e.g. 'Engineering Department')
- `description` (text) — what this department does
- `icon` (text) — Lucide icon name for UI
- `theme_color` (text) — hex color for UI theming
- `sort_order` (int) — display ordering
- `created_at` / `updated_at` — timestamps

### 2. `agent_registry`
Stores agent identity records. Each agent has a permanent immutable `id`
independent of its `display_name`. Users can rename agents without breaking
routing, memory, or workflow references.
- `id` (text, PK) — immutable identifier (e.g. 'temo', 'nova')
- `display_name` (text) — user-visible name, can be changed
- `role` (text) — job title (e.g. 'Chief AI / CEO Coordinator')
- `level` (enum: 'chief' | 'manager' | 'worker') — hierarchy level
- `department_id` (text, FK → agent_departments.id, nullable) — department assignment
- `description` (text) — short description for prompts and UI
- `capabilities` (jsonb) — structured capability list (e.g. ["code_review", "architecture_analysis"])
- `permissions` (jsonb) — permission flags (e.g. {"can_execute_workflows": true, "can_access_memory": true})
- `avatar` (text) — Lucide icon name for the agent
- `theme_color` (text) — hex color
- `status` (enum: 'available' | 'busy' | 'offline') — current availability
- `system_prompt_template` (text) — reference key for prompt builder
- `model` (text) — default AI model for this agent
- `is_active` (boolean, default true) — soft activation flag
- `sort_order` (int) — display ordering within department
- `created_at` / `updated_at` — timestamps

## Security
- RLS enabled on both tables.
- Policies: anon + authenticated full CRUD (single-tenant, no-auth app —
  consistent with all other tables in this project).
- This is intentionally open now; when auth is added in a later phase,
  these policies will be tightened to owner-scoped.

## Seed Data
- 5 departments: Engineering, Automation, Research, Design, Marketing
- 6 agents: Temo (chief, no department), Nova, Flow, Atlas, Luna, Echo
  (all managers, each assigned to their department)

## Important Notes
1. This migration is purely additive — no existing tables are modified.
2. The `agent_registry.id` values match the hardcoded IDs already used by
   the existing routing system (temo, nova, flow, atlas, luna, echo), so
   future migration from the in-memory store to this table will not break
   any routing logic.
3. `level` enum distinguishes chief (coordinator), manager (department head),
   and worker (future task executors).
4. `capabilities` is a structured JSON array that the future Swarm Manager
   will use for capability-based task assignment.
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE agent_level AS ENUM ('chief', 'manager', 'worker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_availability AS ENUM ('available', 'busy', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. AGENT DEPARTMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_departments (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT 'Circle',
  theme_color text NOT NULL DEFAULT '#64748B',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_select_all" ON agent_departments;
CREATE POLICY "dept_select_all" ON agent_departments FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dept_insert_all" ON agent_departments;
CREATE POLICY "dept_insert_all" ON agent_departments FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "dept_update_all" ON agent_departments;
CREATE POLICY "dept_update_all" ON agent_departments FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dept_delete_all" ON agent_departments;
CREATE POLICY "dept_delete_all" ON agent_departments FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 3. AGENT REGISTRY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_registry (
  id                    text PRIMARY KEY,
  display_name          text NOT NULL,
  role                  text NOT NULL,
  level                 agent_level NOT NULL DEFAULT 'worker',
  department_id         text REFERENCES agent_departments(id) ON DELETE SET NULL,
  description           text NOT NULL DEFAULT '',
  capabilities          jsonb NOT NULL DEFAULT '[]'::jsonb,
  permissions           jsonb NOT NULL DEFAULT '{}'::jsonb,
  avatar                text NOT NULL DEFAULT 'Bot',
  theme_color           text NOT NULL DEFAULT '#64748B',
  status                agent_availability NOT NULL DEFAULT 'available',
  system_prompt_template text NOT NULL DEFAULT 'default',
  model                 text NOT NULL DEFAULT 'Gemini 2.0 Flash',
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_select_all" ON agent_registry;
CREATE POLICY "agent_select_all" ON agent_registry FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "agent_insert_all" ON agent_registry;
CREATE POLICY "agent_insert_all" ON agent_registry FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "agent_update_all" ON agent_registry;
CREATE POLICY "agent_update_all" ON agent_registry FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "agent_delete_all" ON agent_registry;
CREATE POLICY "agent_delete_all" ON agent_registry FOR DELETE
  TO anon, authenticated USING (true);

-- Index for department lookups
CREATE INDEX IF NOT EXISTS idx_agent_registry_department ON agent_registry(department_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_level ON agent_registry(level);
CREATE INDEX IF NOT EXISTS idx_agent_registry_active ON agent_registry(is_active) WHERE is_active = true;

-- ============================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_agent_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_departments_updated ON agent_departments;
CREATE TRIGGER trg_agent_departments_updated
  BEFORE UPDATE ON agent_departments
  FOR EACH ROW EXECUTE FUNCTION update_agent_updated_at();

DROP TRIGGER IF EXISTS trg_agent_registry_updated ON agent_registry;
CREATE TRIGGER trg_agent_registry_updated
  BEFORE UPDATE ON agent_registry
  FOR EACH ROW EXECUTE FUNCTION update_agent_updated_at();

-- ============================================================
-- 5. SEED: DEPARTMENTS
-- ============================================================

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order) VALUES
  ('engineering', 'Engineering Department', 'Software architecture, code review, and technical implementation.', 'Code2', '#7B61FF', 1),
  ('automation',  'Automation Department',  'Workflow design, API integration, and process automation.',     'Workflow', '#22C55E', 2),
  ('research',    'Research Department',     'Market research, competitive intelligence, and business analysis.', 'TrendingUp', '#3B82F6', 3),
  ('design',      'Design Department',       'Interface design, brand identity, and visual direction.',      'Palette', '#EC4899', 4),
  ('marketing',   'Marketing Department',    'Content strategy, SEO, copywriting, and social media.',        'PenTool', '#F59E0B', 5)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 6. SEED: AGENTS
-- ============================================================

INSERT INTO agent_registry (id, display_name, role, level, department_id, description, capabilities, permissions, avatar, theme_color, status, system_prompt_template, model, is_active, sort_order) VALUES

  -- Temo — Chief AI / CEO Coordinator (no department)
  (
    'temo', 'Temo', 'Chief AI / CEO Coordinator', 'chief', NULL,
    'Coordinates every agent. Chooses which specialist should answer. Keeps conversations natural.',
    '["agent_routing","conversation_orchestration","multi_agent_synthesis","voice_coordination","crew_management"]'::jsonb,
    '{"can_route_tasks": true, "can_access_memory": true, "can_execute_workflows": true, "can_manage_agents": true}'::jsonb,
    'Sparkles', '#00E5FF', 'available', 'temo_coordinator', 'Gemini 2.0 Flash', true, 0
  ),

  -- Nova — Engineering Manager
  (
    'nova', 'Nova', 'Engineering Manager', 'manager', 'engineering',
    'Manages the Engineering Department. Specializes in programming, debugging, architecture, API design, databases, cloud, and automation.',
    '["code_review","architecture_analysis","software_planning","full_stack_development","api_design","database_modeling","cloud_deployment","devops"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'Code2', '#7B61FF', 'available', 'specialist', 'Gemini 2.0 Flash', true, 1
  ),

  -- Flow — Automation Manager
  (
    'flow', 'Flow', 'Automation Manager', 'manager', 'automation',
    'Manages the Automation Department. Expert in n8n, Make, Zapier, APIs, webhooks, integrations, and automation.',
    '["workflow_design","automation","n8n","api_integration","webhook_configuration","pipeline_architecture","scheduled_triggers","data_transformation"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'Workflow', '#22C55E', 'available', 'specialist', 'Gemini 2.0 Flash', true, 2
  ),

  -- Atlas — Research & Intelligence Manager
  (
    'atlas', 'Atlas', 'Research & Intelligence Manager', 'manager', 'research',
    'Manages the Research Department. Expert in business, marketing, sales, pricing, growth, and analytics.',
    '["market_research","competitive_intelligence","business_analysis","pricing_strategy","growth_planning","revenue_optimization","go_to_market_strategy"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'TrendingUp', '#3B82F6', 'available', 'specialist', 'Gemini 2.0 Flash', true, 3
  ),

  -- Luna — Design Manager
  (
    'luna', 'Luna', 'Design Manager', 'manager', 'design',
    'Manages the Design Department. Expert in UI, UX, branding, graphics, presentation, and motion.',
    '["interface_design","design_systems","brand_identity","visual_direction","motion_design","prototyping","creative_direction"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'Palette', '#EC4899', 'available', 'specialist', 'Gemini 2.0 Flash', true, 4
  ),

  -- Echo — Marketing & Content Manager
  (
    'echo', 'Echo', 'Marketing & Content Manager', 'manager', 'marketing',
    'Manages the Marketing Department. Expert in writing, SEO, YouTube, social media, copywriting, and email.',
    '["content_strategy","seo_optimization","copywriting","social_media_content","email_campaigns","script_writing","headline_crafting"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'PenTool', '#F59E0B', 'available', 'specialist', 'Gemini 2.0 Flash', true, 5
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

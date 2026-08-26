/*
# Add Agent Registry hierarchy metadata

## Purpose
Completes the Level 2 Agent Registry foundation with explicit parent-child
relationships and routing metadata. This is additive only and does not change
application behavior, user interfaces, G-Brain visuals, Voice, Chat, Missions,
APIs, or worker execution.

## Modified table: `agent_registry`
Adds:
- `parent_id` (text, nullable self-reference) — immediate parent agent.
- `children_ids` (jsonb array) — child agent IDs reserved for future workers.
- `priority` (integer) — stable routing/display priority; lower values run first.
- `tools` (jsonb array) — tool IDs available to the agent.

## Seed alignment
- Temo remains the sole `chief` and root agent.
- Nova, Flow, Atlas, Luna, and Echo remain active `manager` agents under Temo.
- Orion is retained as an inactive manager under Temo for a future phase.
- The trading department is added only to preserve Orion's canonical department.

## Security
- No new tables or policies are created.
- Existing single-tenant RLS policies on `agent_registry` remain unchanged.

## Important notes
1. The migration is idempotent and safe to re-apply.
2. No existing columns are removed, renamed, or retyped.
3. `children_ids` stays empty for managers until Workers are introduced.
*/

ALTER TABLE agent_registry
  ADD COLUMN IF NOT EXISTS parent_id text REFERENCES agent_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS children_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tools jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_agent_registry_parent ON agent_registry(parent_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_priority ON agent_registry(priority);

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order)
VALUES ('trading', 'Trading Department', 'Market analysis, trading strategy, and risk management.', 'LineChart', '#F97316', 6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order;

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description, capabilities,
  permissions, avatar, theme_color, status, system_prompt_template, model,
  is_active, sort_order, parent_id, children_ids, priority, tools
)
VALUES (
  'orion', 'Orion', 'Trading Manager', 'manager', 'trading',
  'Manages the Trading Department. Specializes in market analysis, trading strategy, risk management, and portfolio optimization.',
  '["market_analysis","trading_strategy","risk_management","portfolio_optimization","technical_analysis","quantitative_modeling"]'::jsonb,
  '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
  'LineChart', '#F97316', 'offline', 'specialist', 'Gemini 2.0 Flash', false, 6,
  'temo', '[]'::jsonb, 6, '[]'::jsonb
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
  sort_order = EXCLUDED.sort_order,
  parent_id = EXCLUDED.parent_id,
  children_ids = EXCLUDED.children_ids,
  priority = EXCLUDED.priority,
  tools = EXCLUDED.tools;

UPDATE agent_registry
SET parent_id = NULL,
    children_ids = '["nova","flow","atlas","luna","echo","orion"]'::jsonb,
    priority = 0,
    tools = '[]'::jsonb
WHERE id = 'temo';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 1, tools = '["code_review","code_search","file_read","file_write"]'::jsonb
WHERE id = 'nova';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 2, tools = '["n8n_workflow","webhook","api_call"]'::jsonb
WHERE id = 'flow';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 3, tools = '["web_search","data_analysis"]'::jsonb
WHERE id = 'atlas';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 4, tools = '["design_review","asset_generate"]'::jsonb
WHERE id = 'luna';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 5, tools = '["content_write","seo_analyze"]'::jsonb
WHERE id = 'echo';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 6, tools = '[]'::jsonb, is_active = false, status = 'offline'
WHERE id = 'orion';
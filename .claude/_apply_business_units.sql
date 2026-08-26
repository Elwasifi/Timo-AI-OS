/*
# Corporate Office / Operating Companies — Business Units

## Purpose
Adds an internal grouping layer above `agent_departments` so the org chart
can represent Temo AI OS as a Corporate Office overseeing a group of
Operating Companies, instead of one flat list of department managers.

This is deliberately NOT the same concept as `tenants` (external client
isolation, Section 5 of the product brief) — `business_units` is purely an
internal taxonomy over the existing shared `agent_registry` workforce. No
tenant/client table is touched by this migration.

## New table: `business_units`
- `id` (text, PK) — immutable slug (e.g. 'corporate-office', 'company-engineering')
- `name` (text) — display name (e.g. 'AI Engineering & Technology')
- `kind` ('corporate' | 'operating') — Corporate Office vs. an Operating Company
- `description`, `icon`, `theme_color`, `sort_order` — UI metadata, same shape as agent_departments

## Modified table: `agent_departments`
- adds nullable `business_unit_id` (FK → business_units.id)

## What this migration does NOT do
- Does not delete, rename, or deactivate any existing agent or department.
- Does not touch `tenants`, `client_profiles`, or any multi-tenancy table.
- Does not reactivate Orion (stays `is_active=false`, unchanged).

## Seed data
- 7 business units: Corporate Office + one Operating Company per existing
  manager (Engineering, Automation, Research, Design, Marketing, Trading).
- 5 new Corporate Office departments + 5 new corporate-level agents
  (Vertex/Strategy, Forge/R&D, Sentinel/Governance & Risk, Cortex/Corporate
  Intelligence, Ledger/Finance) — new identities, not replacements for any
  existing agent.
- Every existing department gets its `business_unit_id` backfilled.

## Security
- Same RLS pattern as `agent_registry`/`agent_departments` post-tightening
  (see 20260819140000 §10): `authenticated`-only SELECT/INSERT/UPDATE, no
  DELETE policy (deletes go through the service-role server route, same as
  agent deletion already does).
*/

-- ============================================================
-- 1. BUSINESS UNITS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS business_units (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'operating' CHECK (kind IN ('corporate', 'operating')),
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT 'Building2',
  theme_color text NOT NULL DEFAULT '#64748B',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_units_authenticated_select" ON business_units;
CREATE POLICY "business_units_authenticated_select" ON business_units FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "business_units_authenticated_insert" ON business_units;
CREATE POLICY "business_units_authenticated_insert" ON business_units FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "business_units_authenticated_update" ON business_units;
CREATE POLICY "business_units_authenticated_update" ON business_units FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_business_unit_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_units_updated ON business_units;
CREATE TRIGGER trg_business_units_updated
  BEFORE UPDATE ON business_units
  FOR EACH ROW EXECUTE FUNCTION update_business_unit_updated_at();

-- ============================================================
-- 2. LINK agent_departments -> business_units
-- ============================================================

ALTER TABLE agent_departments
  ADD COLUMN IF NOT EXISTS business_unit_id text REFERENCES business_units(id);

CREATE INDEX IF NOT EXISTS idx_agent_departments_business_unit ON agent_departments(business_unit_id);

-- ============================================================
-- 3. SEED: BUSINESS UNITS
-- ============================================================

INSERT INTO business_units (id, name, kind, description, icon, theme_color, sort_order) VALUES
  ('corporate-office',       'Corporate Office',            'corporate', 'Central AI executive office — strategy, R&D, governance, corporate intelligence, and finance for the entire group.', 'Building2', '#facc15', 0),
  ('company-engineering',    'AI Engineering & Technology',  'operating', 'Software architecture, platform engineering, and technical delivery.', 'Code2',      '#7B61FF', 1),
  ('company-automation',     'AI Automation',                'operating', 'Workflow design, integrations, and process automation.',              'Workflow',   '#22C55E', 2),
  ('company-research',       'AI Research & Intelligence',   'operating', 'Market research, competitive intelligence, and business analysis.',   'TrendingUp', '#3B82F6', 3),
  ('company-design',         'AI Design & Creative',         'operating', 'Interface design, brand identity, and visual direction.',             'Palette',    '#EC4899', 4),
  ('company-marketing',      'AI Marketing & Content',       'operating', 'Content strategy, SEO, copywriting, and social media.',               'PenTool',    '#F59E0B', 5),
  ('company-trading',        'Trading Company',              'operating', 'Market analysis, trading strategy, and risk management.',             'LineChart',  '#F97316', 6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description,
  icon = EXCLUDED.icon, theme_color = EXCLUDED.theme_color, sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 4. BACKFILL: existing departments -> their operating company
-- ============================================================

UPDATE agent_departments SET business_unit_id = 'company-engineering' WHERE id = 'engineering';
UPDATE agent_departments SET business_unit_id = 'company-automation'  WHERE id = 'automation';
UPDATE agent_departments SET business_unit_id = 'company-research'    WHERE id = 'research';
UPDATE agent_departments SET business_unit_id = 'company-design'      WHERE id = 'design';
UPDATE agent_departments SET business_unit_id = 'company-marketing'   WHERE id = 'marketing';
UPDATE agent_departments SET business_unit_id = 'company-trading'     WHERE id = 'trading';

-- ============================================================
-- 5. SEED: CORPORATE OFFICE DEPARTMENTS
-- ============================================================

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order, business_unit_id) VALUES
  ('corporate_strategy',      'Strategy',                'Corporate strategy, planning, and cross-company prioritization.',           'Compass',      '#facc15', 10, 'corporate-office'),
  ('rnd_innovation',          'R&D / Innovation',        'Research and development of new capabilities, agents, and product lines.',  'FlaskConical', '#facc15', 11, 'corporate-office'),
  ('governance_risk',         'Governance & Risk',       'Approval gates, policy, compliance, and risk oversight across the group.',  'ShieldCheck',  '#facc15', 12, 'corporate-office'),
  ('corporate_intelligence',  'Corporate Intelligence',  'Organization-wide strategic intelligence reporting directly to the CEO.',    'Radar',        '#facc15', 13, 'corporate-office'),
  ('finance_resources',       'Finance / Resources',     'Usage, cost, credits, and resource allocation across the group.',           'Wallet',       '#facc15', 14, 'corporate-office')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color, sort_order = EXCLUDED.sort_order, business_unit_id = EXCLUDED.business_unit_id;

-- ============================================================
-- 6. SEED: CORPORATE OFFICE AGENTS (new identities — nobody replaced)
-- ============================================================

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description, capabilities,
  permissions, avatar, theme_color, status, system_prompt_template, model,
  is_active, sort_order, parent_id, children_ids, priority, tools
) VALUES
  (
    'vertex', 'Vertex', 'Chief Strategy Officer', 'manager', 'corporate_strategy',
    'Owns corporate strategy: sets priorities across companies, evaluates new opportunities, and aligns operating companies with the group''s direction.',
    '["strategic_planning","portfolio_prioritization","opportunity_evaluation","cross_company_alignment"]'::jsonb,
    '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'Compass', '#facc15', 'available', 'specialist', 'Gemini 2.0 Flash', true, 10, 'temo', '[]'::jsonb, 10, '[]'::jsonb
  ),
  (
    'forge', 'Forge', 'Chief Innovation Officer', 'manager', 'rnd_innovation',
    'Leads R&D and innovation: prototypes new agent capabilities, evaluates new tools/models, and drives internal experimentation.',
    '["capability_research","prototyping","tool_evaluation","model_evaluation"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'FlaskConical', '#facc15', 'available', 'specialist', 'Gemini 2.0 Flash', true, 11, 'temo', '[]'::jsonb, 11, '[]'::jsonb
  ),
  (
    'sentinel', 'Sentinel', 'Chief Governance & Risk Officer', 'manager', 'governance_risk',
    'Owns governance and risk: reviews approval requests, enforces policy, and monitors compliance across every company.',
    '["policy_enforcement","approval_review","compliance_monitoring","risk_assessment"]'::jsonb,
    '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'ShieldCheck', '#facc15', 'available', 'specialist', 'Gemini 2.0 Flash', true, 12, 'temo', '[]'::jsonb, 12, '[]'::jsonb
  ),
  (
    'cortex', 'Cortex', 'Chief Corporate Intelligence Officer', 'manager', 'corporate_intelligence',
    'Provides organization-wide strategic intelligence directly to Temo — distinct from Atlas, who runs day-to-day research for the Research operating company.',
    '["organizational_intelligence","cross_company_analysis","executive_reporting"]'::jsonb,
    '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'Radar', '#facc15', 'available', 'specialist', 'Gemini 2.0 Flash', true, 13, 'temo', '[]'::jsonb, 13, '[]'::jsonb
  ),
  (
    'ledger', 'Ledger', 'Chief Financial Officer', 'manager', 'finance_resources',
    'Owns usage, cost, and resource allocation across the group — reports on AI spend, credits, and budget health.',
    '["cost_analysis","budget_tracking","resource_allocation","usage_reporting"]'::jsonb,
    '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'Wallet', '#facc15', 'available', 'specialist', 'Gemini 2.0 Flash', true, 14, 'temo', '[]'::jsonb, 14, '[]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name, role = EXCLUDED.role, level = EXCLUDED.level,
  department_id = EXCLUDED.department_id, description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities, permissions = EXCLUDED.permissions,
  avatar = EXCLUDED.avatar, theme_color = EXCLUDED.theme_color, status = EXCLUDED.status,
  system_prompt_template = EXCLUDED.system_prompt_template, model = EXCLUDED.model,
  is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order,
  parent_id = EXCLUDED.parent_id, children_ids = EXCLUDED.children_ids,
  priority = EXCLUDED.priority, tools = EXCLUDED.tools;

-- Temo's children_ids gains the 5 new corporate agents alongside the existing 6 managers.
UPDATE agent_registry
SET children_ids = '["nova","flow","atlas","luna","echo","orion","vertex","forge","sentinel","cortex","ledger"]'::jsonb
WHERE id = 'temo';

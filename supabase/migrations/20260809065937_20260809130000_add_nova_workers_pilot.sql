/*
# Nova Worker Pilot — Level 3A

## Purpose
Seeds 3 worker agents under Nova (Engineering Manager) to enable the first
real Manager → Worker delegation layer. This is a controlled pilot — only
Nova gets workers; other managers remain unchanged.

## New agent_registry rows
- nova-frontend (Frontend Engineer, worker, parent: nova)
- nova-backend  (Backend Engineer,  worker, parent: nova)
- nova-qa       (QA & Debug Engineer, worker, parent: nova)

## Updated row
- nova: children_ids updated to include the 3 worker IDs

## Security
- No new tables or policies. Existing RLS policies on agent_registry apply.
- Workers inherit the same single-tenant open CRUD model.

## Important notes
1. Idempotent — safe to re-apply.
2. No existing columns removed or retyped.
3. Workers have level='worker', isActive=true, status='available'.
*/

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description, capabilities,
  permissions, avatar, theme_color, status, system_prompt_template, model,
  is_active, sort_order, parent_id, children_ids, priority, tools
)
VALUES
  (
    'nova-frontend', 'Frontend Engineer', 'Frontend Engineer', 'worker', 'engineering',
    'Frontend specialist focusing on React, Next.js, Tailwind CSS, and UI component development.',
    '["react","nextjs","tailwind","ui_components","jsx","frontend"]'::jsonb,
    '{"canExecuteWorkflows": false, "canAccessMemory": true, "canManageWorkers": false}'::jsonb,
    'Monitor', '#7B61FF', 'available', 'nova_worker', 'Gemini 2.0 Flash',
    true, 10, 'nova', '[]'::jsonb, 10, '["code_search","file_read"]'::jsonb
  ),
  (
    'nova-backend', 'Backend Engineer', 'Backend Engineer', 'worker', 'engineering',
    'Backend specialist focusing on APIs, services, databases, and system integration.',
    '["api_design","database","services","integration","backend","serverless"]'::jsonb,
    '{"canExecuteWorkflows": false, "canAccessMemory": true, "canManageWorkers": false}'::jsonb,
    'Server', '#7B61FF', 'available', 'nova_worker', 'Gemini 2.0 Flash',
    true, 11, 'nova', '[]'::jsonb, 11, '["code_search","file_read"]'::jsonb
  ),
  (
    'nova-qa', 'QA & Debug Engineer', 'QA & Debug Engineer', 'worker', 'engineering',
    'QA specialist focusing on testing, debugging, validation, and error handling.',
    '["testing","debugging","validation","qa","bug_fixing","error_handling"]'::jsonb,
    '{"canExecuteWorkflows": false, "canAccessMemory": true, "canManageWorkers": false}'::jsonb,
    'Bug', '#7B61FF', 'available', 'nova_worker', 'Gemini 2.0 Flash',
    true, 12, 'nova', '[]'::jsonb, 12, '["code_search","file_read"]'::jsonb
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

-- Update Nova's children_ids to include the 3 workers
UPDATE agent_registry
SET children_ids = '["nova-frontend","nova-backend","nova-qa"]'::jsonb
WHERE id = 'nova';
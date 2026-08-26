/*
# Create workflow_registry table

1. Purpose
   Stores metadata about each n8n workflow that Temo has discovered —
   trigger type, webhook paths, activation state, tags, and last sync time.
   This is the "Workflow Metadata Registry" that lets Temo route execution
   requests correctly: webhook-triggered workflows are executed via HTTP
   webhook, manual-trigger workflows are flagged as non-executable, etc.

2. New Tables
   - `workflow_registry`
     - `id` (serial, PK) — internal row ID
     - `workflow_id` (text, not null, unique) — n8n workflow ID
     - `workflow_name` (text, not null) — workflow display name
     - `trigger_type` (text, not null) — detected trigger: webhook | manual | schedule | chat | none
     - `webhook_path` (text) — production webhook path (e.g. "my-flow"), null if no webhook node
     - `webhook_test_path` (text) — test webhook path (webhookId), null if no webhook node
     - `active` (boolean, default false) — whether the workflow is active in n8n
     - `description` (text) — workflow description, nullable
     - `tags` (jsonb, default '[]') — array of tag strings
     - `last_updated` (timestamptz) — when n8n last updated the workflow
     - `synced_at` (timestamptz, default now()) — when Temo last synced this row

3. Security
   - Enable RLS on `workflow_registry`.
   - Single-tenant app (no sign-in screen) → allow anon + authenticated full CRUD.
*/

CREATE TABLE IF NOT EXISTS workflow_registry (
  id serial PRIMARY KEY,
  workflow_id text NOT NULL UNIQUE,
  workflow_name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'none',
  webhook_path text,
  webhook_test_path text,
  active boolean NOT NULL DEFAULT false,
  description text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_updated timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_registry_trigger_type ON workflow_registry (trigger_type);
CREATE INDEX IF NOT EXISTS idx_workflow_registry_active ON workflow_registry (active);

ALTER TABLE workflow_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_select_workflow_registry" ON workflow_registry FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_insert_workflow_registry" ON workflow_registry FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_update_workflow_registry" ON workflow_registry FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_delete_workflow_registry" ON workflow_registry FOR DELETE
  TO anon, authenticated USING (true);

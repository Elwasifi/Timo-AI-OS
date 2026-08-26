/*
# Usage & Cost Governance Foundation — Sprint 3

## Purpose
Creates an append-only Usage Ledger that records AI provider consumption
(tokens, model, provider, estimated cost) at the point where every chat
completion already succeeds — lib/ai/ai-provider.ts's chatWithFallback().
This is the accounting foundation for future cost monitoring, mission/agent
cost attribution, and (later) client billing/quotas. This migration does
NOT implement billing, quotas, or multi-tenancy.

## New table: `usage_ledger`
One row per successful logical AI operation — i.e. one row per
chatWithFallback() call that returns a result, not one row per retried
provider attempt. Failed provider attempts (429/500/network errors) never
reach the point where usage is known, so there is no billable token data
to record for them; recording only successful calls also means retries
never produce duplicate rows. `correlation_id` is reserved for future work
that may want to tie multiple rows together (e.g. a logical operation
later split across recorded attempts) — today it is always 1:1 with `id`.

- `id` (uuid, PK)
- `created_at` (timestamptz) — when the record was written
- `correlation_id` (uuid) — groups rows belonging to one logical operation
- `provider` (text) — provider id (gemini/groq/nvidia/openrouter/ollama/...).
  Intentionally text, not an enum: new providers must not require a schema
  migration to be logged.
- `model` (text) — the resolved model string actually used
- `operation` (text) — logical operation type (chat, tool_response,
  worker_execution, manager_review, mission_task, ...). Text for the same
  extensibility reason as `provider`.
- `input_tokens` / `output_tokens` (integer) — from the provider's reported usage
- `total_tokens` (integer, generated) — input + output
- `cache_read_tokens` / `cache_creation_tokens` (integer, nullable) — reserved
  for providers that report cache token breakdown; no current adapter
  populates these, so they are always NULL today
- `estimated_cost` (numeric) — nullable; NULL when no pricing data exists
  for the provider/model pair
- `cost_is_estimated` (boolean) — always true today (pricing is a static,
  manually maintained table, not live billing data — see lib/ai/pricing.ts)
- `currency` (text, default 'USD')
- `mission_id` / `task_id` (uuid, nullable FK) — set only when the call
  happened inside mission execution
- `agent_id` / `manager_id` (text, nullable FK -> agent_registry.id) — set
  when the call is attributable to a specific agent/manager
- `metadata` (jsonb) — free-form extension point

## Security
RLS enabled. Only SELECT and INSERT policies are defined — there are
intentionally NO UPDATE or DELETE policies, so Postgres RLS denies both by
default even though anon/authenticated otherwise have broad access
elsewhere in this project. This enforces "append-only, never modify or
delete historical usage records" at the database layer, not just by
convention. Consistent with this project's existing single-tenant,
no-auth model — will be tightened to owner/tenant-scoped policies when
authentication is added in a later sprint.

## Important notes
1. Purely additive — no existing tables/columns are modified.
2. `mission_id`/`task_id`/`agent_id`/`manager_id` are all nullable because
   simple chat calls (outside any mission) do not have this context.
3. Schema is intentionally extensible for a future tenant/client/company_id
   column — NOT added in this migration (out of Sprint 3 scope).
*/

CREATE TABLE IF NOT EXISTS usage_ledger (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  correlation_id         uuid NOT NULL DEFAULT gen_random_uuid(),
  provider               text NOT NULL,
  model                  text NOT NULL,
  operation              text NOT NULL DEFAULT 'chat',
  input_tokens           integer NOT NULL DEFAULT 0,
  output_tokens          integer NOT NULL DEFAULT 0,
  total_tokens           integer GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  cache_read_tokens      integer,
  cache_creation_tokens  integer,
  estimated_cost         numeric(14,6),
  cost_is_estimated      boolean NOT NULL DEFAULT true,
  currency               text NOT NULL DEFAULT 'USD',
  mission_id             uuid REFERENCES missions(id) ON DELETE SET NULL,
  task_id                uuid REFERENCES mission_tasks(id) ON DELETE SET NULL,
  agent_id               text REFERENCES agent_registry(id) ON DELETE SET NULL,
  manager_id             text REFERENCES agent_registry(id) ON DELETE SET NULL,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_ledger_select_all" ON usage_ledger;
CREATE POLICY "usage_ledger_select_all" ON usage_ledger FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "usage_ledger_insert_all" ON usage_ledger;
CREATE POLICY "usage_ledger_insert_all" ON usage_ledger FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- No UPDATE or DELETE policies are defined on purpose — RLS denies both
-- by default, enforcing the append-only invariant at the database layer.

CREATE INDEX IF NOT EXISTS idx_usage_ledger_created_at ON usage_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_provider ON usage_ledger(provider);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_model ON usage_ledger(model);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_correlation ON usage_ledger(correlation_id);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_mission ON usage_ledger(mission_id) WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_ledger_task ON usage_ledger(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_ledger_agent ON usage_ledger(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_ledger_manager ON usage_ledger(manager_id) WHERE manager_id IS NOT NULL;

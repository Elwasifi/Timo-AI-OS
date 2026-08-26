/*
# Dynamic Model Router foundation (Intelligent Dynamic Model Router mission, 2026-08-20)

Three additive pieces, all reusing existing infrastructure rather than
duplicating it:

1. `provider_model_catalog` — server-side persistence for the model
   discovery results the "Validate Connection" feature (previous pass)
   already fetches from each provider's real catalog endpoint. That data
   currently lives ONLY in the browser's localStorage (see
   lib/settings/providerModelCache.ts) — completely unreachable from
   server-side mission execution (lib/swarm/executionLayer.ts) or any
   other server context. This table is written by the SAME
   supabase/functions/ai-chat `action:'validate'` handler that already
   calls each adapter's real listModels() — no new discovery logic, just
   a durable place to put results that already exist. Global, not
   per-tenant, matching every other AI-provider-config table in this
   project (app_settings is a single global row too).

2. `provider_model_health` — lightweight, incrementally-updated counters
   per provider+model. usage_ledger only ever records SUCCESSFUL calls
   (by explicit design — see its own migration header) and has no
   latency/failure signal at all, so a health-aware router cannot derive
   reliability purely from usage_ledger. This table is intentionally
   narrow (counters + timestamps, not a full event log) per the mission's
   explicit "do not build an unnecessarily complicated observability
   platform" instruction.

3. `usage_ledger.latency_ms` — one additive nullable column. Successful
   call latency is genuinely usage-adjacent data (same billing-relevant
   event usage_ledger already records), so it belongs there rather than
   in a new table.

4. `app_settings` routing preference columns — global routing
   mode/strategy, following the exact same single-row global-settings
   pattern every other AI provider setting in this table already uses.
   Per-task-type preferences (voice/fast-chat/reasoning/coding/agent-to-
   agent) live in one jsonb column rather than five new scalar columns,
   keeping the schema change minimal.

All additive, idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), no
data loss, no existing table redefined.
*/

CREATE TABLE IF NOT EXISTS provider_model_catalog (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL,
  model_id            text NOT NULL,
  display_name        text,
  context_length      integer,
  input_price         numeric(14,6),
  output_price        numeric(14,6),
  free                boolean,
  supports_streaming  boolean,
  supports_tools      boolean,
  -- Real, provider-reported or name-pattern-inferred capability flags only
  -- (see lib/ai/router/modelCapabilities.ts) — never fabricated. Each key
  -- notes its own confidence; absent = unknown, not false.
  capabilities        jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_model_catalog_provider ON provider_model_catalog(provider);

ALTER TABLE provider_model_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_model_catalog_select" ON provider_model_catalog;
CREATE POLICY "provider_model_catalog_select" ON provider_model_catalog FOR SELECT
  TO authenticated USING (true);
-- No authenticated insert/update policy — this table is written only by
-- the ai-chat edge function's service-role client (the same trust
-- boundary that already reads provider API keys from app_settings),
-- matching how model discovery already works.

CREATE TABLE IF NOT EXISTS provider_model_health (
  provider              text NOT NULL,
  model_id              text NOT NULL,
  success_count         integer NOT NULL DEFAULT 0,
  failure_count         integer NOT NULL DEFAULT 0,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  avg_latency_ms        numeric(10,1),
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_status_code      integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model_id)
);

ALTER TABLE provider_model_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_model_health_select" ON provider_model_health;
CREATE POLICY "provider_model_health_select" ON provider_model_health FOR SELECT
  TO authenticated USING (true);
-- Written only via the service-role client (lib/ai/router/healthTracker.ts,
-- called from server-side code paths only) — same posture as usage_ledger
-- inserts, which are also effectively service-role-driven in practice.

-- Atomic upsert so concurrent requests never lose a counter increment to a
-- read-modify-write race (two requests reading success_count=5 and both
-- writing 6 instead of one reaching 7).
CREATE OR REPLACE FUNCTION record_provider_model_health(
  p_provider text,
  p_model_id text,
  p_success boolean,
  p_latency_ms integer,
  p_status_code integer
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO provider_model_health (
    provider, model_id, success_count, failure_count, consecutive_failures,
    avg_latency_ms, last_success_at, last_failure_at, last_status_code, updated_at
  ) VALUES (
    p_provider, p_model_id,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END,
    CASE WHEN p_success THEN 0 ELSE 1 END,
    p_latency_ms,
    CASE WHEN p_success THEN now() ELSE NULL END,
    CASE WHEN p_success THEN NULL ELSE now() END,
    p_status_code,
    now()
  )
  ON CONFLICT (provider, model_id) DO UPDATE SET
    success_count = provider_model_health.success_count + (CASE WHEN p_success THEN 1 ELSE 0 END),
    failure_count = provider_model_health.failure_count + (CASE WHEN p_success THEN 0 ELSE 1 END),
    consecutive_failures = CASE WHEN p_success THEN 0 ELSE provider_model_health.consecutive_failures + 1 END,
    -- Simple running average — good enough for routing weight purposes,
    -- not a precision metric (mission: "do not over-engineer observability").
    avg_latency_ms = CASE
      WHEN p_latency_ms IS NULL THEN provider_model_health.avg_latency_ms
      WHEN provider_model_health.avg_latency_ms IS NULL THEN p_latency_ms
      ELSE (provider_model_health.avg_latency_ms * 0.7) + (p_latency_ms * 0.3)
    END,
    last_success_at = CASE WHEN p_success THEN now() ELSE provider_model_health.last_success_at END,
    last_failure_at = CASE WHEN p_success THEN provider_model_health.last_failure_at ELSE now() END,
    last_status_code = p_status_code,
    updated_at = now();
END;
$$;

ALTER TABLE usage_ledger ADD COLUMN IF NOT EXISTS latency_ms integer;

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS routing_mode text NOT NULL DEFAULT 'automatic';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS routing_strategy text NOT NULL DEFAULT 'balanced';
-- Per-task-type manual overrides, e.g. {"voice": {"provider":"gemini","model":"gemini-2.5-flash"}}.
-- Empty object = fully automatic (the router decides everything).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS routing_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

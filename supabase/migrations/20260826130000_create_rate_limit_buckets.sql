-- M1-03: token-bucket rate limiting for API routes that can trigger an AI
-- call or a tool execution (docs/BACKLOG-M1.md M1-03). A simple Postgres
-- table + atomic function is enough for V1 — no new infrastructure
-- dependency, matches the existing claim_ready_tasks()-style pattern of
-- doing atomic check-and-consume inside a single plpgsql function rather
-- than app-side read-then-write (which would race under concurrent callers).

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key         text PRIMARY KEY,
  tokens      numeric NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Server-side only (service-role) — never queried directly by anon/authenticated
-- clients, so RLS is enabled with zero policies (default-deny for every role
-- except service-role, which bypasses RLS entirely). Same posture as other
-- server-internal tables in this project.
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_tokens numeric,
  p_refill_per_sec numeric,
  p_cost numeric DEFAULT 1
) RETURNS TABLE(allowed boolean, remaining numeric, reset_seconds numeric)
LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := now();
  v_tokens numeric;
  v_updated_at timestamptz;
  v_elapsed numeric;
  v_new_tokens numeric;
BEGIN
  INSERT INTO rate_limit_buckets (key, tokens, updated_at)
  VALUES (p_key, p_max_tokens, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT tokens, updated_at INTO v_tokens, v_updated_at
  FROM rate_limit_buckets WHERE key = p_key FOR UPDATE;

  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_updated_at)));
  v_new_tokens := LEAST(p_max_tokens, v_tokens + v_elapsed * p_refill_per_sec);

  IF v_new_tokens >= p_cost THEN
    UPDATE rate_limit_buckets SET tokens = v_new_tokens - p_cost, updated_at = v_now WHERE key = p_key;
    RETURN QUERY SELECT true, v_new_tokens - p_cost, 0::numeric;
  ELSE
    UPDATE rate_limit_buckets SET tokens = v_new_tokens, updated_at = v_now WHERE key = p_key;
    RETURN QUERY SELECT false, v_new_tokens, (p_cost - v_new_tokens) / p_refill_per_sec;
  END IF;
END;
$$;

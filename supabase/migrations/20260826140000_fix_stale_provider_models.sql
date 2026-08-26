-- M3-01: fix two dead/broken provider model configurations found by live
-- verification against the real provider APIs (not just code inspection):
--
-- - nvidia_model = 'nvidia/nemotron-mini-4b-instruct' returns HTTP 410 Gone
--   ("has reached its end of life on 2026-08-26T09:00:00Z") — confirmed
--   live against https://integrate.api.nvidia.com/v1/chat/completions.
--   Replaced with 'nvidia/nemotron-3-super-120b-a12b', confirmed live
--   (200, real content, ~1s).
-- - openrouter_model = 'openrouter/auto' returns HTTP 402 ("Insufficient
--   credits. This account never purchased credits.") — 'auto' routes to
--   paid models this account has no credits for. Replaced with
--   'nvidia/nemotron-3-super-120b-a12b:free' (an explicit free-tier model,
--   ':free' suffix), confirmed live (200, real content, ~350ms).
--
-- This is a data fix on the singleton app_settings row, not a schema
-- change — matches the existing seed-migration convention (idempotent,
-- re-runnable) rather than being applied by hand via the SQL editor.
UPDATE app_settings
SET
  nvidia_model = 'nvidia/nemotron-3-super-120b-a12b',
  openrouter_model = 'nvidia/nemotron-3-super-120b-a12b:free',
  updated_at = now()
WHERE id = 1
  AND nvidia_model = 'nvidia/nemotron-mini-4b-instruct'
  AND openrouter_model = 'openrouter/auto';

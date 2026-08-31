-- Milestone 6 — Premium Readiness (M6-02, revised)
--
-- Reverts 20260831150000_add_brave_search_api_key.sql — switched web.search
-- to Gemini's native Search Grounding instead of adding Brave/Tavily as a
-- new vendor. Grounding reuses the existing gemini_api_key (already in the
-- provider fallback chain with a working rotated key, S0-01) — no new
-- key/vendor/account needed, so this column is dropped rather than left
-- unused.

ALTER TABLE app_settings DROP COLUMN IF EXISTS brave_search_api_key;

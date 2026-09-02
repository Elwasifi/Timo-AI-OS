-- Milestone 6 — Premium Readiness (M6-02)
--
-- web.search has been a placeholder handler since it was first registered
-- (lib/tools/builtin-tools.ts's placeholderTools list) — M5-02 fixed the
-- fake-success reporting AROUND it, not the underlying data source, which
-- this ticket closes. Following the same app_settings pattern already used
-- for every other provider key (gemini/groq/nvidia/openrouter/n8n) rather
-- than an env-only secret, so it's rotatable/manageable the same way.

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS brave_search_api_key text;

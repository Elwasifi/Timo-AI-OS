/*
# Create app_settings table for AI provider configuration

1. New Tables
- `app_settings`: single-row configuration table storing AI provider keys, model selection, temperature, max tokens, and voice settings. Single-tenant (no auth) — the app reads/writes as anon.
- `id` (int, primary key, always 1): enforced singleton row
- `gemini_api_key` (text, nullable): Google Gemini API key
- `openai_api_key` (text, nullable): OpenAI API key
- `anthropic_api_key` (text, nullable): Anthropic API key
- `active_provider` (text, default 'gemini'): which provider to use
- `gemini_model` (text, default 'gemini-2.0-flash')
- `openai_model` (text, default 'gpt-4o')
- `anthropic_model` (text, default 'claude-3-5-sonnet-20241022')
- `temperature` (real, default 0.7): generation temperature
- `max_tokens` (int, default 2048): max output tokens
- `updated_at` (timestamptz)

2. Security
- Enable RLS on `app_settings`.
- Allow anon + authenticated CRUD — single-tenant app, data is intentionally shared.
*/

CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  gemini_api_key text,
  openai_api_key text,
  anthropic_api_key text,
  active_provider text NOT NULL DEFAULT 'gemini',
  gemini_model text NOT NULL DEFAULT 'gemini-2.0-flash',
  openai_model text NOT NULL DEFAULT 'gpt-4o',
  anthropic_model text NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
  temperature real NOT NULL DEFAULT 0.7,
  max_tokens int NOT NULL DEFAULT 2048,
  updated_at timestamptz DEFAULT now()
);

-- Seed the singleton row if it doesn't exist
INSERT INTO app_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_settings" ON app_settings;
CREATE POLICY "anon_select_settings" ON app_settings FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_settings" ON app_settings;
CREATE POLICY "anon_insert_settings" ON app_settings FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_settings" ON app_settings;
CREATE POLICY "anon_update_settings" ON app_settings FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_settings" ON app_settings;
CREATE POLICY "anon_delete_settings" ON app_settings FOR DELETE
TO anon, authenticated USING (true);

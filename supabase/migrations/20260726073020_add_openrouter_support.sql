-- Add OpenRouter support to app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS openrouter_api_key text;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS openrouter_model text NOT NULL DEFAULT 'google/gemini-2.0-flash-001';

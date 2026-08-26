/*
# Add Groq, NVIDIA NIM, and Ollama provider support to app_settings

## Purpose
Replaces the OpenAI/Anthropic development dependencies with a new AI provider
stack: Google Gemini, Groq, NVIDIA Build/NIM, OpenRouter, and Ollama (local).

The app_settings table is the SINGLE source of truth for all provider
configuration (API keys, models, base URLs, fallback order). Edge function
secrets are no longer used for provider keys — the edge function reads keys
from this table at request time using the service role. This eliminates the
dual-configuration problem where keys stored in Supabase edge secrets drifted
from keys stored in the database.

## 1. New Columns
- `groq_api_key` (text, nullable): Groq API key (sk_gq_... / gsk_...)
- `groq_model` (text, not null, default 'llama-3.3-70b-versatile')
- `nvidia_api_key` (text, nullable): NVIDIA Build / NIM API key (nvapi-...)
- `nvidia_model` (text, not null, default 'meta/llama-3.1-405b-instruct')
- `ollama_base_url` (text, nullable): Configurable Ollama base URL. NOT hardcoded
  to localhost. Defaults to http://localhost:11434 so a fresh install works,
  but the user must set this to a network-reachable URL for the edge function
  to call it. Configurable from Settings.
- `ollama_api_key` (text, nullable): Optional bearer token if the Ollama
  instance requires auth (e.g. behind a proxy). Nullable.
- `ollama_model` (text, not null, default 'llama3')

## 2. Preserved Columns (NOT dropped — data safety)
- `openai_api_key`, `openai_model`, `anthropic_api_key`, `anthropic_model`
  remain in the table but are no longer referenced by the application during
  development. They are kept to avoid data loss; they can be dropped in a
  later, separate migration once the new stack is confirmed stable.

## 3. RLS
- app_settings already has RLS enabled with anon+authenticated CRUD policies
  (single-tenant, no auth). No policy changes needed. The edge function uses
  the service role, which bypasses RLS, to read the keys.

## 4. Important Notes
- This migration is idempotent (uses IF NOT EXISTS / DO block).
- The singleton row (id = 1) is preserved.
- `active_provider` values of 'openai' or 'anthropic' are NOT migrated here;
  any stale value is normalized by the application's loadSettings() default
  fallback. The new fallback order is Gemini → Groq → NVIDIA → OpenRouter → Ollama.
*/

DO $$
BEGIN
  -- Groq
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'groq_api_key') THEN
    ALTER TABLE app_settings ADD COLUMN groq_api_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'groq_model') THEN
    ALTER TABLE app_settings ADD COLUMN groq_model text NOT NULL DEFAULT 'llama-3.3-70b-versatile';
  END IF;

  -- NVIDIA NIM
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'nvidia_api_key') THEN
    ALTER TABLE app_settings ADD COLUMN nvidia_api_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'nvidia_model') THEN
    ALTER TABLE app_settings ADD COLUMN nvidia_model text NOT NULL DEFAULT 'meta/llama-3.1-405b-instruct';
  END IF;

  -- Ollama (configurable base URL — not hardcoded)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'ollama_base_url') THEN
    ALTER TABLE app_settings ADD COLUMN ollama_base_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'ollama_api_key') THEN
    ALTER TABLE app_settings ADD COLUMN ollama_api_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'ollama_model') THEN
    ALTER TABLE app_settings ADD COLUMN ollama_model text NOT NULL DEFAULT 'llama3';
  END IF;
END $$;
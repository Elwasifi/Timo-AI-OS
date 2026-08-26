/*
# Add n8n integration configuration to app_settings

## Purpose
Adds columns to store n8n server connection configuration. These columns are
the SINGLE source of truth for n8n connectivity — the n8n-proxy edge function
reads them at request time using the service role. The n8n API key is never
exposed to the frontend; the frontend calls the edge function, which proxies
to n8n with the key.

## 1. New Columns
- `n8n_url` (text, nullable): Base URL of the n8n server (e.g. http://localhost:5678)
- `n8n_api_key` (text, nullable): n8n REST API key (X-N8N-API-KEY header). Server-side only.
- `n8n_timeout` (integer, not null, default 30000): Request timeout in milliseconds.
- `n8n_retry_count` (integer, not null, default 3): Number of retries on transient failure.
- `n8n_ssl_verify` (boolean, not null, default true): Whether to verify SSL certificates.
- `n8n_connection_status` (text, nullable): Last known connection status JSON snapshot.

## 2. RLS
- app_settings already has RLS enabled with anon+authenticated CRUD policies.
  No policy changes needed. The edge function uses the service role (bypasses RLS).

## 3. Important Notes
- Idempotent (uses IF NOT EXISTS / DO block).
- The singleton row (id = 1) is preserved.
- No existing columns are modified or dropped.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'n8n_url') THEN
    ALTER TABLE app_settings ADD COLUMN n8n_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'n8n_api_key') THEN
    ALTER TABLE app_settings ADD COLUMN n8n_api_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'n8n_timeout') THEN
    ALTER TABLE app_settings ADD COLUMN n8n_timeout integer NOT NULL DEFAULT 30000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'n8n_retry_count') THEN
    ALTER TABLE app_settings ADD COLUMN n8n_retry_count integer NOT NULL DEFAULT 3;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'n8n_ssl_verify') THEN
    ALTER TABLE app_settings ADD COLUMN n8n_ssl_verify boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'app_settings' AND column_name = 'n8n_connection_status') THEN
    ALTER TABLE app_settings ADD COLUMN n8n_connection_status text;
  END IF;
END $$;
-- ============================================================
-- MIGRATION: 20260725133512_create_app_settings_table.sql
-- ============================================================
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


-- ============================================================
-- MIGRATION: 20260725133530_create_conversations_and_messages.sql
-- ============================================================
/*
# Create conversations and messages tables

1. New Tables
- `conversations`: chat sessions with an agent
  - `id` (uuid, primary key)
  - `title` (text): conversation title
  - `agent_id` (text): which agent handled the conversation
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

- `messages`: individual messages within a conversation
  - `id` (uuid, primary key)
  - `conversation_id` (uuid, foreign key to conversations, cascade delete)
  - `role` (text): 'user' | 'assistant' | 'system'
  - `content` (text): message content
  - `agent_id` (text, nullable): which agent produced this message
  - `confidence` (real, nullable): routing confidence
  - `created_at` (timestamptz)

2. Indexes
- `messages_conversation_id_idx`: fast lookup of messages by conversation

3. Security
- RLS enabled on both tables.
- Allow anon + authenticated CRUD — single-tenant app.
*/

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New Conversation',
  agent_id text NOT NULL DEFAULT 'temo',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  agent_id text,
  confidence real,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- conversations policies
DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_conversations" ON conversations;
CREATE POLICY "anon_delete_conversations" ON conversations FOR DELETE
TO anon, authenticated USING (true);

-- messages policies
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_messages" ON messages;
CREATE POLICY "anon_update_messages" ON messages FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_messages" ON messages;
CREATE POLICY "anon_delete_messages" ON messages FOR DELETE
TO anon, authenticated USING (true);


-- ============================================================
-- MIGRATION: 20260726073020_add_openrouter_support.sql
-- ============================================================
-- Add OpenRouter support to app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS openrouter_api_key text;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS openrouter_model text NOT NULL DEFAULT 'google/gemini-2.0-flash-001';


-- ============================================================
-- MIGRATION: 20260726094715_add_groq_nvidia_ollama_providers.sql.sql
-- ============================================================
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

-- ============================================================
-- MIGRATION: 20260726111304_add_n8n_integration_config.sql.sql
-- ============================================================
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

-- ============================================================
-- MIGRATION: 20260726231639_create_workflow_registry.sql
-- ============================================================
/*
# Create workflow_registry table

1. Purpose
   Stores metadata about each n8n workflow that Temo has discovered —
   trigger type, webhook paths, activation state, tags, and last sync time.
   This is the "Workflow Metadata Registry" that lets Temo route execution
   requests correctly: webhook-triggered workflows are executed via HTTP
   webhook, manual-trigger workflows are flagged as non-executable, etc.

2. New Tables
   - `workflow_registry`
     - `id` (serial, PK) — internal row ID
     - `workflow_id` (text, not null, unique) — n8n workflow ID
     - `workflow_name` (text, not null) — workflow display name
     - `trigger_type` (text, not null) — detected trigger: webhook | manual | schedule | chat | none
     - `webhook_path` (text) — production webhook path (e.g. "my-flow"), null if no webhook node
     - `webhook_test_path` (text) — test webhook path (webhookId), null if no webhook node
     - `active` (boolean, default false) — whether the workflow is active in n8n
     - `description` (text) — workflow description, nullable
     - `tags` (jsonb, default '[]') — array of tag strings
     - `last_updated` (timestamptz) — when n8n last updated the workflow
     - `synced_at` (timestamptz, default now()) — when Temo last synced this row

3. Security
   - Enable RLS on `workflow_registry`.
   - Single-tenant app (no sign-in screen) → allow anon + authenticated full CRUD.
*/

CREATE TABLE IF NOT EXISTS workflow_registry (
  id serial PRIMARY KEY,
  workflow_id text NOT NULL UNIQUE,
  workflow_name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'none',
  webhook_path text,
  webhook_test_path text,
  active boolean NOT NULL DEFAULT false,
  description text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_updated timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_registry_trigger_type ON workflow_registry (trigger_type);
CREATE INDEX IF NOT EXISTS idx_workflow_registry_active ON workflow_registry (active);

ALTER TABLE workflow_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_select_workflow_registry" ON workflow_registry FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_insert_workflow_registry" ON workflow_registry FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_update_workflow_registry" ON workflow_registry FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_workflow_registry" ON workflow_registry;
CREATE POLICY "anon_delete_workflow_registry" ON workflow_registry FOR DELETE
  TO anon, authenticated USING (true);


-- ============================================================
-- MIGRATION: 20260727111732_create_memory_rag_foundation.sql
-- ============================================================
/*
# Memory + RAG Foundation — Phase 4

1. Purpose
   Creates the complete database schema for Temo's Memory Engine. This is the
   foundation of Temo's intelligence — a unified memory system that stores,
   retrieves, and links memories across all agents using pgvector for semantic
   search.

2. New Tables
   - `memories` — the core memory table. Each row is a single memory record
     with type, content, importance, tags, agent, tool, project, and soft-delete.
   - `memory_embeddings` — vector embeddings for semantic search (pgvector).
   - `memory_links` — knowledge graph edges between memories.
   - `memory_events` — episodic memory timeline events.
   - `memory_settings` — configurable memory engine parameters.

3. Extensions
   - Enables `pgvector` extension for vector similarity search.

4. Security
   - RLS enabled on all tables.
   - Single-tenant app (no sign-in) → anon + authenticated full CRUD.
   - Soft delete via `deleted_at` column on `memories`.

5. Important Notes
   - The `memories.embedding` column is NOT stored inline — embeddings live in
     `memory_embeddings` to keep the core table lean.
   - `importance` is an enum: critical, high, medium, low, temporary.
   - `memory_type` is an enum: short_term, long_term, episodic, semantic.
   - All timestamps are timestamptz with defaults.
*/

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Importance levels
DO $$ BEGIN
  CREATE TYPE memory_importance AS ENUM ('critical', 'high', 'medium', 'low', 'temporary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Memory types
DO $$ BEGIN
  CREATE TYPE memory_type AS ENUM ('short_term', 'long_term', 'episodic', 'semantic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Link relationship types
DO $$ BEGIN
  CREATE TYPE memory_link_type AS ENUM ('relates_to', 'caused_by', 'part_of', 'derived_from', 'replaced_by', 'supports', 'contradicts');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Core memories table
CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type memory_type NOT NULL DEFAULT 'long_term',
  title text NOT NULL,
  content text NOT NULL,
  summary text,
  tags text[] NOT NULL DEFAULT '{}',
  importance memory_importance NOT NULL DEFAULT 'medium',
  importance_score int NOT NULL DEFAULT 50,
  source text,
  agent text,
  tool text,
  project text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories (importance);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories (agent);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories (project);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories (created_at desc);
CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories (deleted_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories (expires_at);

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memories" ON memories;
CREATE POLICY "anon_select_memories" ON memories FOR SELECT
  TO anon, authenticated USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "anon_insert_memories" ON memories;
CREATE POLICY "anon_insert_memories" ON memories FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_memories" ON memories;
CREATE POLICY "anon_update_memories" ON memories FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memories" ON memories;
CREATE POLICY "anon_delete_memories" ON memories FOR DELETE
  TO anon, authenticated USING (true);

-- Embeddings table (separate for performance)
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  embedding vector(768),
  model text,
  provider text,
  chunk_index int NOT NULL DEFAULT 0,
  chunk_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id ON memory_embeddings (memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings (model);

-- Vector similarity index (IVFFlat for production-scale search)
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_vector
  ON memory_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_select_memory_embeddings" ON memory_embeddings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_insert_memory_embeddings" ON memory_embeddings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_update_memory_embeddings" ON memory_embeddings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_delete_memory_embeddings" ON memory_embeddings FOR DELETE
  TO anon, authenticated USING (true);

-- Knowledge graph links
CREATE TABLE IF NOT EXISTS memory_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  link_type memory_link_type NOT NULL DEFAULT 'relates_to',
  weight float NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links (source_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links (target_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_type ON memory_links (link_type);

ALTER TABLE memory_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_links" ON memory_links;
CREATE POLICY "anon_select_memory_links" ON memory_links FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_links" ON memory_links;
CREATE POLICY "anon_insert_memory_links" ON memory_links FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_links" ON memory_links;
CREATE POLICY "anon_delete_memory_links" ON memory_links FOR DELETE
  TO anon, authenticated USING (true);

-- Episodic events timeline
CREATE TABLE IF NOT EXISTS memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_title text NOT NULL,
  event_detail text,
  agent text,
  project text,
  severity text NOT NULL DEFAULT 'info',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events (event_type);
CREATE INDEX IF NOT EXISTS idx_memory_events_agent ON memory_events (agent);
CREATE INDEX IF NOT EXISTS idx_memory_events_created_at ON memory_events (created_at desc);

ALTER TABLE memory_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_events" ON memory_events;
CREATE POLICY "anon_select_memory_events" ON memory_events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_events" ON memory_events;
CREATE POLICY "anon_insert_memory_events" ON memory_events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_events" ON memory_events;
CREATE POLICY "anon_delete_memory_events" ON memory_events FOR DELETE
  TO anon, authenticated USING (true);

-- Memory settings (single row, id=1)
CREATE TABLE IF NOT EXISTS memory_settings (
  id int PRIMARY KEY DEFAULT 1,
  embedding_provider text NOT NULL DEFAULT 'gemini',
  embedding_model text NOT NULL DEFAULT 'text-embedding-004',
  chunk_size int NOT NULL DEFAULT 512,
  chunk_overlap int NOT NULL DEFAULT 50,
  top_k int NOT NULL DEFAULT 5,
  similarity_threshold float NOT NULL DEFAULT 0.7,
  auto_remember boolean NOT NULL DEFAULT true,
  auto_summarize boolean NOT NULL DEFAULT true,
  memory_expiration_days int NOT NULL DEFAULT 30,
  max_short_term_items int NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO memory_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE memory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_settings" ON memory_settings;
CREATE POLICY "anon_select_memory_settings" ON memory_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_memory_settings" ON memory_settings;
CREATE POLICY "anon_update_memory_settings" ON memory_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- Auto-update updated_at on memories
CREATE OR REPLACE FUNCTION update_memory_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_updated_at ON memories;
CREATE TRIGGER trg_memories_updated_at BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_memory_updated_at();

-- Function to clean expired short-term memories
CREATE OR REPLACE FUNCTION clean_expired_memories()
RETURNS int AS $$
DECLARE
  deleted_count int;
BEGIN
  UPDATE memories SET deleted_at = now()
    WHERE expires_at IS NOT NULL
      AND expires_at < now()
      AND deleted_at IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- MIGRATION: 20260727111830_create_match_memories_function.sql
-- ============================================================
/*
# Create match_memories function for semantic search

1. Purpose
   RPC function used by the memoryStore.semanticSearch() to find memories
   by vector similarity (cosine distance). Filters by type, agent, and
   similarity threshold.

2. Functions
   - `match_memories(query_embedding vector, match_count int, filter_type text, filter_agent text, threshold float)`
     Returns memory records with a `similarity` column (1 - cosine_distance).

3. Security
   - Function is SECURITY DEFINER so it can access the vector index.
   - Only returns non-deleted memories.
*/

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  filter_type text DEFAULT NULL,
  filter_agent text DEFAULT NULL,
  threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  type memory_type,
  title text,
  content text,
  summary text,
  tags text[],
  importance memory_importance,
  importance_score int,
  source text,
  agent text,
  tool text,
  project text,
  metadata jsonb,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.type,
    m.title,
    m.content,
    m.summary,
    m.tags,
    m.importance,
    m.importance_score,
    m.source,
    m.agent,
    m.tool,
    m.project,
    m.metadata,
    m.expires_at,
    m.deleted_at,
    m.created_at,
    m.updated_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM memory_embeddings e
  JOIN memories m ON m.id = e.memory_id
  WHERE m.deleted_at IS NULL
    AND (filter_type IS NULL OR m.type::text = filter_type)
    AND (filter_agent IS NULL OR m.agent = filter_agent)
    AND 1 - (e.embedding <=> query_embedding) >= threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ============================================================
-- MIGRATION: 20260727112722_update_vector_dimension_3072.sql
-- ============================================================
/*
# Update vector dimension to 3072 for Gemini embeddings

Gemini's gemini-embedding-001 model produces 3072-dimensional vectors.
Uses HNSW index instead of IVFFlat (which has a 2000-dimension limit).
*/

DROP INDEX IF EXISTS idx_memory_embeddings_vector;
DROP TABLE IF EXISTS memory_embeddings;

CREATE TABLE memory_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  embedding vector(3072),
  model text,
  provider text,
  chunk_index int NOT NULL DEFAULT 0,
  chunk_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id ON memory_embeddings (memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings (model);

-- pgvector caps BOTH ivfflat and hnsw indexes at 2000 dimensions
-- (see https://github.com/pgvector/pgvector#indexing — "Indexes support up
-- to 2,000 dimensions"). vector(3072) categorically cannot be indexed by
-- either method today, so no index is created here — match_memories()
-- falls back to an exact sequential scan (`ORDER BY embedding <=> ...`),
-- which is correct and fast enough at this project's current scale.
-- Do not re-attempt an ANN index on this column until pgvector raises the
-- dimension cap, or until embeddings are stored at <=2000 dimensions.

ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_select_memory_embeddings" ON memory_embeddings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_insert_memory_embeddings" ON memory_embeddings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_update_memory_embeddings" ON memory_embeddings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_memory_embeddings" ON memory_embeddings;
CREATE POLICY "anon_delete_memory_embeddings" ON memory_embeddings FOR DELETE
  TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(3072),
  match_count int DEFAULT 5,
  filter_type text DEFAULT NULL,
  filter_agent text DEFAULT NULL,
  threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid, type memory_type, title text, content text, summary text,
  tags text[], importance memory_importance, importance_score int,
  source text, agent text, tool text, project text, metadata jsonb,
  expires_at timestamptz, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, similarity float
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.type, m.title, m.content, m.summary, m.tags, m.importance,
    m.importance_score, m.source, m.agent, m.tool, m.project, m.metadata,
    m.expires_at, m.deleted_at, m.created_at, m.updated_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM memory_embeddings e
  JOIN memories m ON m.id = e.memory_id
  WHERE m.deleted_at IS NULL
    AND (filter_type IS NULL OR m.type::text = filter_type)
    AND (filter_agent IS NULL OR m.agent = filter_agent)
    AND 1 - (e.embedding <=> query_embedding) >= threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ============================================================
-- MIGRATION: 20260727202804_create_knowledge_engine_foundation.sql.sql
-- ============================================================
/*
# Knowledge Engine Foundation — Phase 2

1. Purpose
   Creates the database schema for Timo AI OS's Knowledge Engine. This is the
   structured knowledge layer that sits above the existing semantic memory
   system. It stores facts as semantic triples (subject → predicate → object)
   with confidence, versioning, and conflict tracking. The Knowledge Engine
   becomes the single source of truth — all modules query through it, never
   touching database tables directly.

2. New Tables
   - `structured_facts` — facts stored as triples (subject, predicate, object)
     with category, confidence, versioning, and soft-delete. One active fact
     per (subject, predicate) pair enforced by a partial unique index.
   - `fact_revisions` — audit log of every change to a structured fact
     (created, updated, superseded, conflict_resolved, soft_deleted).

3. New Enums
   - `fact_category` — classifies knowledge type: preference, identity, project,
     configuration, environment, workflow, habit, decision, rule, goal,
     relationship, task, fact, history, temporary.

4. New Functions
   - `upsert_structured_fact(...)` — atomic insert-or-conflict detection.
     Returns action ('created', 'duplicate', 'conflict') with old/new values.
   - `replace_structured_fact(...)` — supersedes an old fact with a new version,
     creating the version chain and revision record.
   - `match_structured_facts(...)` — O(1) lookup by subject+predicate, or
     ILIKE search across object/predicate, with optional category filter.
   - `get_fact_history(...)` — returns all versions of a fact (including
     superseded) ordered by version number.

5. Bug Fix
   - Recreates `match_memories()` with vector(3072) signature. The original
     function (migration 20260727111830) used vector(768) but embeddings
     were upgraded to 3072 dimensions in migration 20260727112722. The
     function was never updated, causing semantic search to fail.

6. Security
   - RLS enabled on all new tables.
   - Single-tenant app (no sign-in) → anon + authenticated full CRUD.
   - All policies use TO anon, authenticated.

7. Important Notes
   - No existing tables are altered or dropped (except match_memories which
     is CREATE OR REPLACE).
   - The partial unique index on (subject, predicate) ensures only one active
     fact per pair — superseded facts retain their row but are excluded.
   - `superseded_by` and `previous_version_id` create a linked list of versions.
   - `semantic_memory_id` links a structured fact to its semantic memory
     counterpart in the `memories` table (nullable — not all facts have one).
*/
-- ---- Enum: fact_category ----
DO $$ BEGIN
  CREATE TYPE fact_category AS ENUM (
    'preference', 'identity', 'project', 'configuration', 'environment',
    'workflow', 'habit', 'decision', 'rule', 'goal', 'relationship',
    'task', 'fact', 'history', 'temporary'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Table: structured_facts ----
CREATE TABLE IF NOT EXISTS structured_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  predicate text NOT NULL,
  object text NOT NULL,
  category fact_category NOT NULL DEFAULT 'fact',
  confidence int NOT NULL DEFAULT 100,
  confidence_source text NOT NULL DEFAULT 'user',
  confidence_reason text,
  verified boolean NOT NULL DEFAULT true,
  importance memory_importance NOT NULL DEFAULT 'high',
  tags text[] NOT NULL DEFAULT '{}',
  semantic_memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  superseded_by uuid REFERENCES structured_facts(id) ON DELETE SET NULL,
  version int NOT NULL DEFAULT 1,
  previous_version_id uuid REFERENCES structured_facts(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active fact per (subject, predicate) — superseded and deleted rows excluded
CREATE UNIQUE INDEX IF NOT EXISTS idx_structured_facts_subject_predicate_active
  ON structured_facts (subject, predicate)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_structured_facts_subject ON structured_facts (subject);
CREATE INDEX IF NOT EXISTS idx_structured_facts_predicate ON structured_facts (predicate);
CREATE INDEX IF NOT EXISTS idx_structured_facts_category ON structured_facts (category);
CREATE INDEX IF NOT EXISTS idx_structured_facts_object ON structured_facts (object);
CREATE INDEX IF NOT EXISTS idx_structured_facts_semantic_memory ON structured_facts (semantic_memory_id);
CREATE INDEX IF NOT EXISTS idx_structured_facts_tags ON structured_facts USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_structured_facts_created_at ON structured_facts (created_at desc);

ALTER TABLE structured_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_structured_facts" ON structured_facts;
CREATE POLICY "anon_select_structured_facts" ON structured_facts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_structured_facts" ON structured_facts;
CREATE POLICY "anon_insert_structured_facts" ON structured_facts FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_structured_facts" ON structured_facts;
CREATE POLICY "anon_update_structured_facts" ON structured_facts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_structured_facts" ON structured_facts;
CREATE POLICY "anon_delete_structured_facts" ON structured_facts FOR DELETE
  TO anon, authenticated USING (true);

-- ---- Table: fact_revisions ----
CREATE TABLE IF NOT EXISTS fact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id uuid NOT NULL REFERENCES structured_facts(id) ON DELETE CASCADE,
  revision_type text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  old_confidence int,
  new_confidence int,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fact_revisions_fact_id ON fact_revisions (fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_revisions_type ON fact_revisions (revision_type);
CREATE INDEX IF NOT EXISTS idx_fact_revisions_created_at ON fact_revisions (created_at desc);

ALTER TABLE fact_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_fact_revisions" ON fact_revisions;
CREATE POLICY "anon_select_fact_revisions" ON fact_revisions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_fact_revisions" ON fact_revisions;
CREATE POLICY "anon_insert_fact_revisions" ON fact_revisions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_fact_revisions" ON fact_revisions;
CREATE POLICY "anon_delete_fact_revisions" ON fact_revisions FOR DELETE
  TO anon, authenticated USING (true);

-- ---- Auto-update updated_at on structured_facts ----
CREATE OR REPLACE FUNCTION update_structured_fact_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_structured_facts_updated_at ON structured_facts;
CREATE TRIGGER trg_structured_facts_updated_at BEFORE UPDATE ON structured_facts
  FOR EACH ROW EXECUTE FUNCTION update_structured_fact_updated_at();

-- ---- Function: upsert_structured_fact ----
-- Atomic insert-or-conflict detection. Returns the action taken.
CREATE OR REPLACE FUNCTION upsert_structured_fact(
  p_subject text,
  p_predicate text,
  p_object text,
  p_category fact_category DEFAULT 'fact',
  p_confidence int DEFAULT 100,
  p_confidence_source text DEFAULT 'user',
  p_confidence_reason text DEFAULT NULL,
  p_importance memory_importance DEFAULT 'high',
  p_tags text[] DEFAULT '{}',
  p_semantic_memory_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  action text,
  fact_id uuid,
  conflict boolean,
  old_value text,
  old_fact_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
  existing_object text;
  existing_confidence int;
  new_id uuid;
BEGIN
  -- Find the active fact for this (subject, predicate)
  SELECT id, object, confidence INTO existing_id, existing_object, existing_confidence
  FROM structured_facts
  WHERE subject = p_subject
    AND predicate = p_predicate
    AND deleted_at IS NULL
    AND superseded_by IS NULL
  LIMIT 1;

  IF existing_id IS NULL THEN
    -- No existing fact → create new
    INSERT INTO structured_facts (
      subject, predicate, object, category, confidence,
      confidence_source, confidence_reason, importance, tags,
      semantic_memory_id, metadata
    ) VALUES (
      p_subject, p_predicate, p_object, p_category, p_confidence,
      p_confidence_source, p_confidence_reason, p_importance, p_tags,
      p_semantic_memory_id, p_metadata
    )
    RETURNING id INTO new_id;

    INSERT INTO fact_revisions (fact_id, revision_type, new_value, new_confidence, reason)
    VALUES (new_id, 'created', p_object, p_confidence, p_confidence_reason);

    RETURN QUERY SELECT 'created'::text, new_id, false, NULL::text, NULL::uuid;
  ELSIF existing_object = p_object THEN
    -- Same value → duplicate, no change
    RETURN QUERY SELECT 'duplicate'::text, existing_id, false, existing_object, NULL::uuid;
  ELSE
    -- Different value → conflict (caller decides resolution)
    RETURN QUERY SELECT 'conflict'::text, existing_id, true, existing_object, existing_id;
  END IF;
END;
$$;

-- ---- Function: replace_structured_fact ----
-- Supersedes an old fact with a new version, creating the version chain.
CREATE OR REPLACE FUNCTION replace_structured_fact(
  p_old_fact_id uuid,
  p_new_object text,
  p_reason text DEFAULT NULL,
  p_new_confidence int DEFAULT NULL,
  p_new_confidence_reason text DEFAULT NULL
)
RETURNS TABLE (new_fact_id uuid, old_fact_id uuid, new_version int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_record RECORD;
  new_id uuid;
  new_version int;
  new_conf int;
BEGIN
  SELECT * INTO old_record FROM structured_facts WHERE id = p_old_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fact % not found', p_old_fact_id;
  END IF;

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  -- Insert the new version
  INSERT INTO structured_facts (
    subject, predicate, object, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  -- Mark old fact as superseded
  UPDATE structured_facts
  SET superseded_by = new_id
  WHERE id = p_old_fact_id;

  -- Create revision record
  INSERT INTO fact_revisions (fact_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;

-- ---- Function: match_structured_facts ----
-- O(1) lookup by subject+predicate, or ILIKE search with category filter.
CREATE OR REPLACE FUNCTION match_structured_facts(
  p_subject text DEFAULT NULL,
  p_predicate text DEFAULT NULL,
  p_categories fact_category[] DEFAULT NULL,
  p_search_text text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  confidence_source text,
  confidence_reason text,
  verified boolean,
  importance memory_importance,
  tags text[],
  semantic_memory_id uuid,
  metadata jsonb,
  superseded_by uuid,
  version int,
  previous_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_subject IS NOT NULL AND p_predicate IS NOT NULL THEN
    -- O(1) direct lookup
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE subject = p_subject
      AND predicate = p_predicate
      AND deleted_at IS NULL
      AND superseded_by IS NULL
    LIMIT 1;
  ELSIF p_subject IS NOT NULL THEN
    -- All active facts for a subject
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE subject = p_subject
      AND deleted_at IS NULL
      AND superseded_by IS NULL
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY created_at DESC
    LIMIT p_limit;
  ELSIF p_search_text IS NOT NULL THEN
    -- ILIKE search across object and predicate
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE (object ILIKE '%' || p_search_text || '%'
           OR predicate ILIKE '%' || p_search_text || '%')
      AND deleted_at IS NULL
      AND superseded_by IS NULL
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY created_at DESC
    LIMIT p_limit;
  ELSE
    -- Browse all active facts
    RETURN QUERY
    SELECT * FROM structured_facts
    WHERE deleted_at IS NULL
      AND superseded_by IS NULL
      AND (p_categories IS NULL OR category = ANY(p_categories))
    ORDER BY created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

-- ---- Function: get_fact_history ----
-- Returns all versions of a fact (including superseded) ordered by version.
CREATE OR REPLACE FUNCTION get_fact_history(
  p_subject text,
  p_predicate text
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  version int,
  superseded_by uuid,
  previous_version_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT id, subject, predicate, object, category, confidence, version,
         superseded_by, previous_version_id, created_at
  FROM structured_facts
  WHERE subject = p_subject
    AND predicate = p_predicate
    AND deleted_at IS NULL
  ORDER BY version ASC;
END;
$$;

-- ---- Bug Fix: Recreate match_memories with vector(3072) ----
-- The original function used vector(768) but embeddings were upgraded to
-- 3072 dimensions. This fixes semantic search.
DROP FUNCTION IF EXISTS match_memories(vector, int, text, text, float);
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(3072),
  match_count int DEFAULT 5,
  filter_type text DEFAULT NULL,
  filter_agent text DEFAULT NULL,
  threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid, type memory_type, title text, content text, summary text,
  tags text[], importance memory_importance, importance_score int,
  source text, agent text, tool text, project text, metadata jsonb,
  expires_at timestamptz, deleted_at timestamptz,
  created_at timestamptz, updated_at timestamptz, similarity float
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.type, m.title, m.content, m.summary, m.tags, m.importance,
    m.importance_score, m.source, m.agent, m.tool, m.project, m.metadata,
    m.expires_at, m.deleted_at, m.created_at, m.updated_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM memory_embeddings e
  JOIN memories m ON m.id = e.memory_id
  WHERE m.deleted_at IS NULL
    AND (filter_type IS NULL OR m.type::text = filter_type)
    AND (filter_agent IS NULL OR m.agent = filter_agent)
    AND 1 - (e.embedding <=> query_embedding) >= threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- MIGRATION: 20260727203426_fix_match_structured_facts_ambiguity.sql.sql
-- ============================================================
/*
# Fix match_structured_facts column ambiguity

The PL/pgSQL function parameters (p_subject, p_predicate, etc.) shadowed
table column names (subject, predicate), causing "column reference is
ambiguous" errors. This migration recreates the function with table-qualified
column references (sf.subject, sf.predicate, etc.).
*/

DROP FUNCTION IF EXISTS match_structured_facts(text, text, fact_category[], text, int);

CREATE OR REPLACE FUNCTION match_structured_facts(
  p_subject text DEFAULT NULL,
  p_predicate text DEFAULT NULL,
  p_categories fact_category[] DEFAULT NULL,
  p_search_text text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  confidence_source text,
  confidence_reason text,
  verified boolean,
  importance memory_importance,
  tags text[],
  semantic_memory_id uuid,
  metadata jsonb,
  superseded_by uuid,
  version int,
  previous_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_subject IS NOT NULL AND p_predicate IS NOT NULL THEN
    -- O(1) direct lookup
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.predicate = p_predicate
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
    LIMIT 1;
  ELSIF p_subject IS NOT NULL THEN
    -- All active facts for a subject
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSIF p_search_text IS NOT NULL THEN
    -- ILIKE search across object and predicate
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE (sf.object ILIKE '%' || p_search_text || '%'
           OR sf.predicate ILIKE '%' || p_search_text || '%')
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSE
    -- Browse all active facts
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

-- Also fix get_fact_history with the same ambiguity issue
DROP FUNCTION IF EXISTS get_fact_history(text, text);

CREATE OR REPLACE FUNCTION get_fact_history(
  p_subject text,
  p_predicate text
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  version int,
  superseded_by uuid,
  previous_version_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
         sf.confidence, sf.version, sf.superseded_by, sf.previous_version_id,
         sf.created_at
  FROM structured_facts sf
  WHERE sf.subject = p_subject
    AND sf.predicate = p_predicate
    AND sf.deleted_at IS NULL
  ORDER BY sf.version ASC;
END;
$$;

-- ============================================================
-- MIGRATION: 20260727203441_fix_replace_structured_fact_order.sql.sql
-- ============================================================
/*
# Fix replace_structured_fact order of operations

The function tried to INSERT the new fact before marking the old one as
superseded, which violated the partial unique index on (subject, predicate)
for active facts. Fixed by marking the old fact as superseded FIRST, then
inserting the new version.
*/

DROP FUNCTION IF EXISTS replace_structured_fact(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION replace_structured_fact(
  p_old_fact_id uuid,
  p_new_object text,
  p_reason text DEFAULT NULL,
  p_new_confidence int DEFAULT NULL,
  p_new_confidence_reason text DEFAULT NULL
)
RETURNS TABLE (new_fact_id uuid, old_fact_id uuid, new_version int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_record RECORD;
  new_id uuid;
  new_version int;
  new_conf int;
BEGIN
  SELECT * INTO old_record FROM structured_facts WHERE id = p_old_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fact % not found', p_old_fact_id;
  END IF;

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  -- Mark old fact as superseded FIRST (frees up the unique index slot)
  UPDATE structured_facts
  SET superseded_by = gen_random_uuid()  -- placeholder UUID, will be updated
  WHERE id = p_old_fact_id;

  -- Insert the new version
  INSERT INTO structured_facts (
    subject, predicate, object, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  -- Now update the old fact's superseded_by to point to the real new fact
  UPDATE structured_facts
  SET superseded_by = new_id
  WHERE id = p_old_fact_id;

  -- Create revision record
  INSERT INTO fact_revisions (fact_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;

-- ============================================================
-- MIGRATION: 20260727203453_fix_replace_structured_fact_fk.sql.sql
-- ============================================================
/*
# Fix replace_structured_fact FK constraint

The superseded_by column has a self-referential FK constraint, so we can't
set it to a placeholder UUID that doesn't exist yet. Instead, we mark the
old fact as "superseded" by setting deleted_at temporarily (which removes
it from the unique index), insert the new fact, then clear deleted_at and
set superseded_by to the new fact's ID.
*/

DROP FUNCTION IF EXISTS replace_structured_fact(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION replace_structured_fact(
  p_old_fact_id uuid,
  p_new_object text,
  p_reason text DEFAULT NULL,
  p_new_confidence int DEFAULT NULL,
  p_new_confidence_reason text DEFAULT NULL
)
RETURNS TABLE (new_fact_id uuid, old_fact_id uuid, new_version int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_record RECORD;
  new_id uuid;
  new_version int;
  new_conf int;
BEGIN
  SELECT * INTO old_record FROM structured_facts WHERE id = p_old_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fact % not found', p_old_fact_id;
  END IF;

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  -- Temporarily mark old fact as deleted to free up the unique index slot.
  -- The deleted_at column is part of the partial unique index condition
  -- (WHERE deleted_at IS NULL AND superseded_by IS NULL), so setting it
  -- removes the row from the index.
  UPDATE structured_facts SET deleted_at = now() WHERE id = p_old_fact_id;

  -- Insert the new version
  INSERT INTO structured_facts (
    subject, predicate, object, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  -- Now set the old fact's superseded_by to the new fact and clear deleted_at
  UPDATE structured_facts
  SET superseded_by = new_id, deleted_at = NULL
  WHERE id = p_old_fact_id;

  -- Create revision record
  INSERT INTO fact_revisions (fact_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;

-- ============================================================
-- MIGRATION: 20260727225714_create_agent_registry_foundation.sql
-- ============================================================
/*
# Agent Registry Foundation — Phase 1: Manager Architecture

## Purpose
Creates the database foundation for a scalable Agent Registry that supports
departments, manager-level agents, and future worker agents. This is Phase 1
of the Swarm Architecture — it does NOT implement the Swarm Manager, Task Queue,
or any execution logic. It only provides the persistent identity layer.

## New Tables

### 1. `agent_departments`
Stores department definitions. Each department has one manager and will
eventually hold multiple workers.
- `id` (text, PK) — immutable slug identifier (e.g. 'engineering')
- `name` (text) — display name (e.g. 'Engineering Department')
- `description` (text) — what this department does
- `icon` (text) — Lucide icon name for UI
- `theme_color` (text) — hex color for UI theming
- `sort_order` (int) — display ordering
- `created_at` / `updated_at` — timestamps

### 2. `agent_registry`
Stores agent identity records. Each agent has a permanent immutable `id`
independent of its `display_name`. Users can rename agents without breaking
routing, memory, or workflow references.
- `id` (text, PK) — immutable identifier (e.g. 'temo', 'nova')
- `display_name` (text) — user-visible name, can be changed
- `role` (text) — job title (e.g. 'Chief AI / CEO Coordinator')
- `level` (enum: 'chief' | 'manager' | 'worker') — hierarchy level
- `department_id` (text, FK → agent_departments.id, nullable) — department assignment
- `description` (text) — short description for prompts and UI
- `capabilities` (jsonb) — structured capability list (e.g. ["code_review", "architecture_analysis"])
- `permissions` (jsonb) — permission flags (e.g. {"can_execute_workflows": true, "can_access_memory": true})
- `avatar` (text) — Lucide icon name for the agent
- `theme_color` (text) — hex color
- `status` (enum: 'available' | 'busy' | 'offline') — current availability
- `system_prompt_template` (text) — reference key for prompt builder
- `model` (text) — default AI model for this agent
- `is_active` (boolean, default true) — soft activation flag
- `sort_order` (int) — display ordering within department
- `created_at` / `updated_at` — timestamps

## Security
- RLS enabled on both tables.
- Policies: anon + authenticated full CRUD (single-tenant, no-auth app —
  consistent with all other tables in this project).
- This is intentionally open now; when auth is added in a later phase,
  these policies will be tightened to owner-scoped.

## Seed Data
- 5 departments: Engineering, Automation, Research, Design, Marketing
- 6 agents: Temo (chief, no department), Nova, Flow, Atlas, Luna, Echo
  (all managers, each assigned to their department)

## Important Notes
1. This migration is purely additive — no existing tables are modified.
2. The `agent_registry.id` values match the hardcoded IDs already used by
   the existing routing system (temo, nova, flow, atlas, luna, echo), so
   future migration from the in-memory store to this table will not break
   any routing logic.
3. `level` enum distinguishes chief (coordinator), manager (department head),
   and worker (future task executors).
4. `capabilities` is a structured JSON array that the future Swarm Manager
   will use for capability-based task assignment.
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE agent_level AS ENUM ('chief', 'manager', 'worker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_availability AS ENUM ('available', 'busy', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. AGENT DEPARTMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_departments (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT 'Circle',
  theme_color text NOT NULL DEFAULT '#64748B',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_select_all" ON agent_departments;
CREATE POLICY "dept_select_all" ON agent_departments FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dept_insert_all" ON agent_departments;
CREATE POLICY "dept_insert_all" ON agent_departments FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "dept_update_all" ON agent_departments;
CREATE POLICY "dept_update_all" ON agent_departments FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dept_delete_all" ON agent_departments;
CREATE POLICY "dept_delete_all" ON agent_departments FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 3. AGENT REGISTRY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_registry (
  id                    text PRIMARY KEY,
  display_name          text NOT NULL,
  role                  text NOT NULL,
  level                 agent_level NOT NULL DEFAULT 'worker',
  department_id         text REFERENCES agent_departments(id) ON DELETE SET NULL,
  description           text NOT NULL DEFAULT '',
  capabilities          jsonb NOT NULL DEFAULT '[]'::jsonb,
  permissions           jsonb NOT NULL DEFAULT '{}'::jsonb,
  avatar                text NOT NULL DEFAULT 'Bot',
  theme_color           text NOT NULL DEFAULT '#64748B',
  status                agent_availability NOT NULL DEFAULT 'available',
  system_prompt_template text NOT NULL DEFAULT 'default',
  model                 text NOT NULL DEFAULT 'Gemini 2.0 Flash',
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_select_all" ON agent_registry;
CREATE POLICY "agent_select_all" ON agent_registry FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "agent_insert_all" ON agent_registry;
CREATE POLICY "agent_insert_all" ON agent_registry FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "agent_update_all" ON agent_registry;
CREATE POLICY "agent_update_all" ON agent_registry FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "agent_delete_all" ON agent_registry;
CREATE POLICY "agent_delete_all" ON agent_registry FOR DELETE
  TO anon, authenticated USING (true);

-- Index for department lookups
CREATE INDEX IF NOT EXISTS idx_agent_registry_department ON agent_registry(department_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_level ON agent_registry(level);
CREATE INDEX IF NOT EXISTS idx_agent_registry_active ON agent_registry(is_active) WHERE is_active = true;

-- ============================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_agent_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_departments_updated ON agent_departments;
CREATE TRIGGER trg_agent_departments_updated
  BEFORE UPDATE ON agent_departments
  FOR EACH ROW EXECUTE FUNCTION update_agent_updated_at();

DROP TRIGGER IF EXISTS trg_agent_registry_updated ON agent_registry;
CREATE TRIGGER trg_agent_registry_updated
  BEFORE UPDATE ON agent_registry
  FOR EACH ROW EXECUTE FUNCTION update_agent_updated_at();

-- ============================================================
-- 5. SEED: DEPARTMENTS
-- ============================================================

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order) VALUES
  ('engineering', 'Engineering Department', 'Software architecture, code review, and technical implementation.', 'Code2', '#7B61FF', 1),
  ('automation',  'Automation Department',  'Workflow design, API integration, and process automation.',     'Workflow', '#22C55E', 2),
  ('research',    'Research Department',     'Market research, competitive intelligence, and business analysis.', 'TrendingUp', '#3B82F6', 3),
  ('design',      'Design Department',       'Interface design, brand identity, and visual direction.',      'Palette', '#EC4899', 4),
  ('marketing',   'Marketing Department',    'Content strategy, SEO, copywriting, and social media.',        'PenTool', '#F59E0B', 5)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 6. SEED: AGENTS
-- ============================================================

INSERT INTO agent_registry (id, display_name, role, level, department_id, description, capabilities, permissions, avatar, theme_color, status, system_prompt_template, model, is_active, sort_order) VALUES

  -- Temo — Chief AI / CEO Coordinator (no department)
  (
    'temo', 'Temo', 'Chief AI / CEO Coordinator', 'chief', NULL,
    'Coordinates every agent. Chooses which specialist should answer. Keeps conversations natural.',
    '["agent_routing","conversation_orchestration","multi_agent_synthesis","voice_coordination","crew_management"]'::jsonb,
    '{"can_route_tasks": true, "can_access_memory": true, "can_execute_workflows": true, "can_manage_agents": true}'::jsonb,
    'Sparkles', '#00E5FF', 'available', 'temo_coordinator', 'Gemini 2.0 Flash', true, 0
  ),

  -- Nova — Engineering Manager
  (
    'nova', 'Nova', 'Engineering Manager', 'manager', 'engineering',
    'Manages the Engineering Department. Specializes in programming, debugging, architecture, API design, databases, cloud, and automation.',
    '["code_review","architecture_analysis","software_planning","full_stack_development","api_design","database_modeling","cloud_deployment","devops"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'Code2', '#7B61FF', 'available', 'specialist', 'Gemini 2.0 Flash', true, 1
  ),

  -- Flow — Automation Manager
  (
    'flow', 'Flow', 'Automation Manager', 'manager', 'automation',
    'Manages the Automation Department. Expert in n8n, Make, Zapier, APIs, webhooks, integrations, and automation.',
    '["workflow_design","automation","n8n","api_integration","webhook_configuration","pipeline_architecture","scheduled_triggers","data_transformation"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'Workflow', '#22C55E', 'available', 'specialist', 'Gemini 2.0 Flash', true, 2
  ),

  -- Atlas — Research & Intelligence Manager
  (
    'atlas', 'Atlas', 'Research & Intelligence Manager', 'manager', 'research',
    'Manages the Research Department. Expert in business, marketing, sales, pricing, growth, and analytics.',
    '["market_research","competitive_intelligence","business_analysis","pricing_strategy","growth_planning","revenue_optimization","go_to_market_strategy"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'TrendingUp', '#3B82F6', 'available', 'specialist', 'Gemini 2.0 Flash', true, 3
  ),

  -- Luna — Design Manager
  (
    'luna', 'Luna', 'Design Manager', 'manager', 'design',
    'Manages the Design Department. Expert in UI, UX, branding, graphics, presentation, and motion.',
    '["interface_design","design_systems","brand_identity","visual_direction","motion_design","prototyping","creative_direction"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'Palette', '#EC4899', 'available', 'specialist', 'Gemini 2.0 Flash', true, 4
  ),

  -- Echo — Marketing & Content Manager
  (
    'echo', 'Echo', 'Marketing & Content Manager', 'manager', 'marketing',
    'Manages the Marketing Department. Expert in writing, SEO, YouTube, social media, copywriting, and email.',
    '["content_strategy","seo_optimization","copywriting","social_media_content","email_campaigns","script_writing","headline_crafting"]'::jsonb,
    '{"can_execute_workflows": true, "can_access_memory": true, "can_manage_workers": true}'::jsonb,
    'PenTool', '#F59E0B', 'available', 'specialist', 'Gemini 2.0 Flash', true, 5
  )

ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  level = EXCLUDED.level,
  department_id = EXCLUDED.department_id,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  permissions = EXCLUDED.permissions,
  avatar = EXCLUDED.avatar,
  theme_color = EXCLUDED.theme_color,
  status = EXCLUDED.status,
  system_prompt_template = EXCLUDED.system_prompt_template,
  model = EXCLUDED.model,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;


-- ============================================================
-- MIGRATION: 20260727233657_create_mission_engine_and_task_queue.sql
-- ============================================================
/*
# Phase 2 — Mission Engine + Task Queue + Trading Department

## Purpose
Creates the persistent backend for the Mission-Oriented AI Operating System.
Missions are decomposed into objectives, which are decomposed into tasks.
Tasks live in a database-backed queue and are dispatched to managers by the
Swarm Manager using capability matching — never hardcoded agent names.

Also registers a new Trading department with an inactive manager (Orion).

## New Tables

### 1. `missions`
Top-level mission objects created from user requests.
- id (uuid PK)
- title (text) — short human label
- objective (text) — the single concrete goal
- user_request (text) — original user input verbatim
- priority (enum: low/medium/high/critical, default medium)
- status (enum: pending/planning/ready/executing/reviewing/completed/failed/cancelled/paused, default pending)
- progress (int 0-100, default 0)
- estimated_complexity (enum: simple/medium/complex, default simple)
- estimated_tasks (int, default 1)
- parent_mission_id (uuid, self-ref FK, nullable) — for sub-missions
- metadata (jsonb) — extensibility bag (tags, analytics, learning data)
- created_at / updated_at — timestamps

### 2. `mission_objectives`
Decomposition layer between mission and tasks.
- id (uuid PK)
- mission_id (uuid FK → missions, cascade delete)
- title (text)
- required_capability (text) — e.g. 'code_review', 'workflow_design'
- estimated_effort (enum: low/medium/high)
- dependencies (jsonb) — array of objective IDs that must complete first
- status (enum: pending/ready/in_progress/completed/failed, default pending)
- sort_order (int)
- created_at / updated_at

### 3. `mission_tasks`
The persistent task queue. Each task is an executable unit assigned to a manager.
- id (uuid PK)
- mission_id (uuid FK → missions, cascade delete)
- objective_id (uuid FK → mission_objectives, cascade delete, nullable)
- parent_task_id (uuid self-ref FK, nullable) — for task decomposition
- assigned_manager (text, nullable) — agent_registry.id of the assigned manager
- assigned_worker (text, nullable) — agent_registry.id of a future worker
- required_capability (text) — the capability needed to execute this task
- title (text) — what to do
- description (text) — detailed instruction
- priority (enum: low/medium/high/critical, default medium)
- status (enum: waiting/ready/running/completed/failed/cancelled, default waiting)
- dependencies (jsonb) — array of task IDs that must complete first
- retries (int, default 0)
- max_retries (int, default 3)
- execution_log (jsonb, default []) — append-only log of execution events
- result (jsonb, nullable) — task output
- error_message (text, nullable)
- created_at / updated_at / started_at / completed_at

### 4. `mission_timeline`
Append-only event log tracking the full lifecycle of every mission.
- id (uuid PK)
- mission_id (uuid FK → missions, cascade delete)
- event_type (enum: mission_created, mission_planned, objectives_generated,
  tasks_created, task_assigned, task_started, task_completed, task_failed,
  mission_completed, mission_failed, mission_cancelled, mission_paused,
  mission_resumed, review_started, review_completed)
- entity_type (text, nullable) — 'mission' | 'objective' | 'task'
- entity_id (text, nullable) — ID of the related entity
- title (text) — human-readable event label
- detail (text) — additional context
- metadata (jsonb, default {})
- created_at (timestamptz, default now())

## New Seed Data
- Trading Department (id='trading', icon='LineChart', color='#F97316')
- Orion agent (id='orion', level='manager', department='trading', is_active=false)

## Security
- RLS enabled on all 4 new tables.
- Policies: anon + authenticated full CRUD (single-tenant, no-auth app —
  consistent with all other tables in this project).
- The `agent_registry` and `agent_departments` tables from Phase 1 are
  extended with new seed rows only — no schema changes.

## Extensibility Notes
1. `missions.parent_mission_id` supports sub-mission decomposition.
2. `mission_tasks.parent_task_id` supports task decomposition by managers.
3. `mission_tasks.assigned_worker` is nullable and unused now — ready for Phase 3.
4. `missions.metadata` is a jsonb bag for future analytics, learning, tags.
5. `mission_tasks.execution_log` is append-only jsonb for full audit trail.
6. `mission_timeline` captures every lifecycle event for the future dashboard.
7. The `status` enums include 'paused'/'cancelled' for future pause/resume.
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE mission_status AS ENUM (
    'pending', 'planning', 'ready', 'executing',
    'reviewing', 'completed', 'failed', 'cancelled', 'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_complexity AS ENUM ('simple', 'medium', 'complex');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE objective_status AS ENUM (
    'pending', 'ready', 'in_progress', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE objective_effort AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_queue_status AS ENUM (
    'waiting', 'ready', 'running', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_timeline_event AS ENUM (
    'mission_created', 'mission_planned', 'objectives_generated',
    'tasks_created', 'task_assigned', 'task_started', 'task_completed',
    'task_failed', 'mission_completed', 'mission_failed',
    'mission_cancelled', 'mission_paused', 'mission_resumed',
    'review_started', 'review_completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. MISSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS missions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL,
  objective            text NOT NULL,
  user_request         text NOT NULL,
  priority             mission_priority NOT NULL DEFAULT 'medium',
  status               mission_status NOT NULL DEFAULT 'pending',
  progress             integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  estimated_complexity mission_complexity NOT NULL DEFAULT 'simple',
  estimated_tasks      integer NOT NULL DEFAULT 1 CHECK (estimated_tasks >= 0),
  parent_mission_id    uuid REFERENCES missions(id) ON DELETE SET NULL,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_select_all" ON missions;
CREATE POLICY "mission_select_all" ON missions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "mission_insert_all" ON missions;
CREATE POLICY "mission_insert_all" ON missions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "mission_update_all" ON missions;
CREATE POLICY "mission_update_all" ON missions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "mission_delete_all" ON missions;
CREATE POLICY "mission_delete_all" ON missions FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_parent ON missions(parent_mission_id);
CREATE INDEX IF NOT EXISTS idx_missions_priority ON missions(priority);

-- ============================================================
-- 3. MISSION OBJECTIVES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS mission_objectives (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id          uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title               text NOT NULL,
  required_capability text NOT NULL,
  estimated_effort    objective_effort NOT NULL DEFAULT 'medium',
  dependencies        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              objective_status NOT NULL DEFAULT 'pending',
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mission_objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "obj_select_all" ON mission_objectives;
CREATE POLICY "obj_select_all" ON mission_objectives FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "obj_insert_all" ON mission_objectives;
CREATE POLICY "obj_insert_all" ON mission_objectives FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "obj_update_all" ON mission_objectives;
CREATE POLICY "obj_update_all" ON mission_objectives FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "obj_delete_all" ON mission_objectives;
CREATE POLICY "obj_delete_all" ON mission_objectives FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_objectives_mission ON mission_objectives(mission_id);
CREATE INDEX IF NOT EXISTS idx_objectives_status ON mission_objectives(status);

-- ============================================================
-- 4. MISSION TASKS TABLE (Persistent Task Queue)
-- ============================================================

CREATE TABLE IF NOT EXISTS mission_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id          uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  objective_id        uuid REFERENCES mission_objectives(id) ON DELETE CASCADE,
  parent_task_id      uuid REFERENCES mission_tasks(id) ON DELETE SET NULL,
  assigned_manager    text,
  assigned_worker     text,
  required_capability text NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  priority            mission_priority NOT NULL DEFAULT 'medium',
  status              task_queue_status NOT NULL DEFAULT 'waiting',
  dependencies        jsonb NOT NULL DEFAULT '[]'::jsonb,
  retries             integer NOT NULL DEFAULT 0,
  max_retries         integer NOT NULL DEFAULT 3,
  execution_log       jsonb NOT NULL DEFAULT '[]'::jsonb,
  result              jsonb,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

ALTER TABLE mission_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_select_all" ON mission_tasks;
CREATE POLICY "task_select_all" ON mission_tasks FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "task_insert_all" ON mission_tasks;
CREATE POLICY "task_insert_all" ON mission_tasks FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "task_update_all" ON mission_tasks;
CREATE POLICY "task_update_all" ON mission_tasks FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "task_delete_all" ON mission_tasks;
CREATE POLICY "task_delete_all" ON mission_tasks FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_tasks_mission ON mission_tasks(mission_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON mission_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_manager ON mission_tasks(assigned_manager);
CREATE INDEX IF NOT EXISTS idx_tasks_ready ON mission_tasks(status) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON mission_tasks(priority);

-- ============================================================
-- 5. MISSION TIMELINE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS mission_timeline (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  event_type  mission_timeline_event NOT NULL,
  entity_type text,
  entity_id   text,
  title       text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mission_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timeline_select_all" ON mission_timeline;
CREATE POLICY "timeline_select_all" ON mission_timeline FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "timeline_insert_all" ON mission_timeline;
CREATE POLICY "timeline_insert_all" ON mission_timeline FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "timeline_update_all" ON mission_timeline;
CREATE POLICY "timeline_update_all" ON mission_timeline FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "timeline_delete_all" ON mission_timeline;
CREATE POLICY "timeline_delete_all" ON mission_timeline FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_timeline_mission ON mission_timeline(mission_id);
CREATE INDEX IF NOT EXISTS idx_timeline_created ON mission_timeline(created_at);

-- ============================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_mission_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_missions_updated ON missions;
CREATE TRIGGER trg_missions_updated
  BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION update_mission_updated_at();

DROP TRIGGER IF EXISTS trg_objectives_updated ON mission_objectives;
CREATE TRIGGER trg_objectives_updated
  BEFORE UPDATE ON mission_objectives
  FOR EACH ROW EXECUTE FUNCTION update_mission_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated ON mission_tasks;
CREATE TRIGGER trg_tasks_updated
  BEFORE UPDATE ON mission_tasks
  FOR EACH ROW EXECUTE FUNCTION update_mission_updated_at();

-- ============================================================
-- 7. SEED: TRADING DEPARTMENT
-- ============================================================

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order) VALUES
  ('trading', 'Trading Department', 'Market analysis, trading strategy, and risk management.', 'LineChart', '#F97316', 6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 8. SEED: ORION — Trading Manager (Inactive)
-- ============================================================

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description,
  capabilities, permissions, avatar, theme_color, status,
  system_prompt_template, model, is_active, sort_order
) VALUES
  (
    'orion', 'Orion', 'Trading Manager', 'manager', 'trading',
    'Manages the Trading Department. Specializes in market analysis, trading strategy, risk management, and portfolio optimization. Currently inactive — will be activated in a future phase.',
    '["market_analysis","trading_strategy","risk_management","portfolio_optimization","technical_analysis","quantitative_modeling"]'::jsonb,
    '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
    'LineChart', '#F97316', 'offline',
    'specialist', 'Gemini 2.0 Flash', false, 6
  )
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  level = EXCLUDED.level,
  department_id = EXCLUDED.department_id,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  permissions = EXCLUDED.permissions,
  avatar = EXCLUDED.avatar,
  theme_color = EXCLUDED.theme_color,
  status = EXCLUDED.status,
  system_prompt_template = EXCLUDED.system_prompt_template,
  model = EXCLUDED.model,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;


-- ============================================================
-- MIGRATION: 20260728072715_add_execution_timeline_events.sql
-- ============================================================
/*
# Phase 3 — Execution Layer Timeline Events

## Purpose
Extends the `mission_timeline_event` enum with execution-level events
that the Execution Layer emits during task execution. These events
capture the granular steps of each task's execution — tool selection,
workflow execution, memory/knowledge retrieval, provider selection,
retries, and failures — making the timeline the complete data source
for the future cinematic dashboard.

## Changes
- Adds 11 new event types to the existing `mission_timeline_event` enum:
  decision_made, pipeline_selected, execution_started, tool_selected,
  workflow_executed, memory_retrieved, knowledge_retrieved,
  provider_selected, execution_finished, execution_failed,
  execution_retried, mission_updated

- Adds `task_timeout_ms` column to `mission_tasks` for per-task
  timeout configuration (nullable, defaults to 30000ms = 30s).

## Safety
- ALTER TYPE ... ADD VALUE is non-destructive — existing rows keep
  their existing enum values.
- The new column is nullable with a default, so existing rows get
  the default automatically.
- No data is dropped or renamed.
*/

-- ============================================================
-- 1. ADD EXECUTION-LEVEL TIMELINE EVENT TYPES
-- ============================================================

ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'decision_made';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'pipeline_selected';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_started';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'tool_selected';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'workflow_executed';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'memory_retrieved';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'knowledge_retrieved';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'provider_selected';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_finished';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_failed';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'execution_retried';
ALTER TYPE mission_timeline_event ADD VALUE IF NOT EXISTS 'mission_updated';

-- ============================================================
-- 2. ADD TASK TIMEOUT COLUMN
-- ============================================================

ALTER TABLE mission_tasks
  ADD COLUMN IF NOT EXISTS task_timeout_ms integer DEFAULT 30000;


-- ============================================================
-- MIGRATION: 20260728074348_create_runtime_state_tables.sql
-- ============================================================
/*
# Phase 4 — Runtime State Persistence

## Purpose
Stores the current runtime state of Temo AI OS so the application
behaves as one persistent AI Operating System. This replaces
in-memory-only runtime state with database-backed state that
survives page reloads and session restarts.

## Tables
- `runtime_state`: single-row table holding the current mission,
  current manager, running tasks, execution state, and recent activity.
- `runtime_activity`: append-only feed of recent runtime events
  (decisions, routing, executions, completions, failures).

## Safety
- New tables only — no existing tables modified.
- RLS enabled with authenticated access.
*/

-- ============================================================
-- 1. RUNTIME STATE (single-row persistent state)
-- ============================================================

CREATE TABLE IF NOT EXISTS runtime_state (
  id text PRIMARY KEY DEFAULT 'default',
  current_mission_id text,
  current_manager_id text DEFAULT 'temo',
  execution_state text DEFAULT 'idle',
  running_task_ids text[] DEFAULT '{}',
  mission_progress integer DEFAULT 0,
  timeline_summary jsonb DEFAULT '[]',
  metadata jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

INSERT INTO runtime_state (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE runtime_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_runtime_state" ON runtime_state FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_runtime_state" ON runtime_state FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_runtime_state" ON runtime_state FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_runtime_state" ON runtime_state FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 2. RUNTIME ACTIVITY FEED (append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS runtime_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  title text NOT NULL,
  detail text DEFAULT '',
  agent_id text,
  mission_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runtime_activity_created
  ON runtime_activity (created_at DESC);

ALTER TABLE runtime_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_runtime_activity" ON runtime_activity FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_runtime_activity" ON runtime_activity FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "delete_runtime_activity" ON runtime_activity FOR DELETE
  TO anon, authenticated USING (true);


-- ============================================================
-- MIGRATION: 20260809064549_20260809120000_add_agent_hierarchy_metadata.sql
-- ============================================================
/*
# Add Agent Registry hierarchy metadata

## Purpose
Completes the Level 2 Agent Registry foundation with explicit parent-child
relationships and routing metadata. This is additive only and does not change
application behavior, user interfaces, G-Brain visuals, Voice, Chat, Missions,
APIs, or worker execution.

## Modified table: `agent_registry`
Adds:
- `parent_id` (text, nullable self-reference) — immediate parent agent.
- `children_ids` (jsonb array) — child agent IDs reserved for future workers.
- `priority` (integer) — stable routing/display priority; lower values run first.
- `tools` (jsonb array) — tool IDs available to the agent.

## Seed alignment
- Temo remains the sole `chief` and root agent.
- Nova, Flow, Atlas, Luna, and Echo remain active `manager` agents under Temo.
- Orion is retained as an inactive manager under Temo for a future phase.
- The trading department is added only to preserve Orion's canonical department.

## Security
- No new tables or policies are created.
- Existing single-tenant RLS policies on `agent_registry` remain unchanged.

## Important notes
1. The migration is idempotent and safe to re-apply.
2. No existing columns are removed, renamed, or retyped.
3. `children_ids` stays empty for managers until Workers are introduced.
*/

ALTER TABLE agent_registry
  ADD COLUMN IF NOT EXISTS parent_id text REFERENCES agent_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS children_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tools jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_agent_registry_parent ON agent_registry(parent_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_priority ON agent_registry(priority);

INSERT INTO agent_departments (id, name, description, icon, theme_color, sort_order)
VALUES ('trading', 'Trading Department', 'Market analysis, trading strategy, and risk management.', 'LineChart', '#F97316', 6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  theme_color = EXCLUDED.theme_color,
  sort_order = EXCLUDED.sort_order;

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description, capabilities,
  permissions, avatar, theme_color, status, system_prompt_template, model,
  is_active, sort_order, parent_id, children_ids, priority, tools
)
VALUES (
  'orion', 'Orion', 'Trading Manager', 'manager', 'trading',
  'Manages the Trading Department. Specializes in market analysis, trading strategy, risk management, and portfolio optimization.',
  '["market_analysis","trading_strategy","risk_management","portfolio_optimization","technical_analysis","quantitative_modeling"]'::jsonb,
  '{"can_execute_workflows": false, "can_access_memory": true, "can_manage_workers": false}'::jsonb,
  'LineChart', '#F97316', 'offline', 'specialist', 'Gemini 2.0 Flash', false, 6,
  'temo', '[]'::jsonb, 6, '[]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  level = EXCLUDED.level,
  department_id = EXCLUDED.department_id,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  permissions = EXCLUDED.permissions,
  avatar = EXCLUDED.avatar,
  theme_color = EXCLUDED.theme_color,
  status = EXCLUDED.status,
  system_prompt_template = EXCLUDED.system_prompt_template,
  model = EXCLUDED.model,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  parent_id = EXCLUDED.parent_id,
  children_ids = EXCLUDED.children_ids,
  priority = EXCLUDED.priority,
  tools = EXCLUDED.tools;

UPDATE agent_registry
SET parent_id = NULL,
    children_ids = '["nova","flow","atlas","luna","echo","orion"]'::jsonb,
    priority = 0,
    tools = '[]'::jsonb
WHERE id = 'temo';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 1, tools = '["code_review","code_search","file_read","file_write"]'::jsonb
WHERE id = 'nova';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 2, tools = '["n8n_workflow","webhook","api_call"]'::jsonb
WHERE id = 'flow';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 3, tools = '["web_search","data_analysis"]'::jsonb
WHERE id = 'atlas';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 4, tools = '["design_review","asset_generate"]'::jsonb
WHERE id = 'luna';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 5, tools = '["content_write","seo_analyze"]'::jsonb
WHERE id = 'echo';

UPDATE agent_registry
SET parent_id = 'temo', children_ids = '[]'::jsonb, priority = 6, tools = '[]'::jsonb, is_active = false, status = 'offline'
WHERE id = 'orion';

-- ============================================================
-- MIGRATION: 20260809065937_20260809130000_add_nova_workers_pilot.sql
-- ============================================================
/*
# Nova Worker Pilot — Level 3A

## Purpose
Seeds 3 worker agents under Nova (Engineering Manager) to enable the first
real Manager → Worker delegation layer. This is a controlled pilot — only
Nova gets workers; other managers remain unchanged.

## New agent_registry rows
- nova-frontend (Frontend Engineer, worker, parent: nova)
- nova-backend  (Backend Engineer,  worker, parent: nova)
- nova-qa       (QA & Debug Engineer, worker, parent: nova)

## Updated row
- nova: children_ids updated to include the 3 worker IDs

## Security
- No new tables or policies. Existing RLS policies on agent_registry apply.
- Workers inherit the same single-tenant open CRUD model.

## Important notes
1. Idempotent — safe to re-apply.
2. No existing columns removed or retyped.
3. Workers have level='worker', isActive=true, status='available'.
*/

INSERT INTO agent_registry (
  id, display_name, role, level, department_id, description, capabilities,
  permissions, avatar, theme_color, status, system_prompt_template, model,
  is_active, sort_order, parent_id, children_ids, priority, tools
)
VALUES
  (
    'nova-frontend', 'Frontend Engineer', 'Frontend Engineer', 'worker', 'engineering',
    'Frontend specialist focusing on React, Next.js, Tailwind CSS, and UI component development.',
    '["react","nextjs","tailwind","ui_components","jsx","frontend"]'::jsonb,
    '{"canExecuteWorkflows": false, "canAccessMemory": true, "canManageWorkers": false}'::jsonb,
    'Monitor', '#7B61FF', 'available', 'nova_worker', 'Gemini 2.0 Flash',
    true, 10, 'nova', '[]'::jsonb, 10, '["code_search","file_read"]'::jsonb
  ),
  (
    'nova-backend', 'Backend Engineer', 'Backend Engineer', 'worker', 'engineering',
    'Backend specialist focusing on APIs, services, databases, and system integration.',
    '["api_design","database","services","integration","backend","serverless"]'::jsonb,
    '{"canExecuteWorkflows": false, "canAccessMemory": true, "canManageWorkers": false}'::jsonb,
    'Server', '#7B61FF', 'available', 'nova_worker', 'Gemini 2.0 Flash',
    true, 11, 'nova', '[]'::jsonb, 11, '["code_search","file_read"]'::jsonb
  ),
  (
    'nova-qa', 'QA & Debug Engineer', 'QA & Debug Engineer', 'worker', 'engineering',
    'QA specialist focusing on testing, debugging, validation, and error handling.',
    '["testing","debugging","validation","qa","bug_fixing","error_handling"]'::jsonb,
    '{"canExecuteWorkflows": false, "canAccessMemory": true, "canManageWorkers": false}'::jsonb,
    'Bug', '#7B61FF', 'available', 'nova_worker', 'Gemini 2.0 Flash',
    true, 12, 'nova', '[]'::jsonb, 12, '["code_search","file_read"]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  level = EXCLUDED.level,
  department_id = EXCLUDED.department_id,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  permissions = EXCLUDED.permissions,
  avatar = EXCLUDED.avatar,
  theme_color = EXCLUDED.theme_color,
  status = EXCLUDED.status,
  system_prompt_template = EXCLUDED.system_prompt_template,
  model = EXCLUDED.model,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  parent_id = EXCLUDED.parent_id,
  children_ids = EXCLUDED.children_ids,
  priority = EXCLUDED.priority,
  tools = EXCLUDED.tools;

-- Update Nova's children_ids to include the 3 workers
UPDATE agent_registry
SET children_ids = '["nova-frontend","nova-backend","nova-qa"]'::jsonb
WHERE id = 'nova';

-- ============================================================
-- MIGRATION: 20260809091512_add_runtime_event_columns.sql
-- ============================================================
/*
# Phase 3A — Runtime Event Standardization

## Purpose
Add worker_id, task_id, and status columns to runtime_activity so every
emitted event carries the full execution chain context (agent, worker,
mission, task) plus a standardized status field.

## Safety
- ALTER TABLE ADD COLUMN only — no data loss, no type changes.
- Nullable columns with defaults — existing rows are unaffected.
*/

ALTER TABLE runtime_activity
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS task_id text,
  ADD COLUMN IF NOT EXISTS status text;

CREATE INDEX IF NOT EXISTS idx_runtime_activity_event_type
  ON runtime_activity (event_type);

CREATE INDEX IF NOT EXISTS idx_runtime_activity_agent
  ON runtime_activity (agent_id);


-- ============================================================
-- MIGRATION: 20260819120000_create_usage_ledger.sql
-- ============================================================
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



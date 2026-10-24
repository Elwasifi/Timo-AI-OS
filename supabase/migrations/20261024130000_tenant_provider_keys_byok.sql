-- M7-09 — BYOK (Bring Your Own Key): per-tenant AI provider credentials,
-- plus closing a live credential-exposure gap found while scoping this
-- ticket.
--
-- Part 1: new tenant_provider_keys table. Confirmed scope: gemini, groq,
-- nvidia, openrouter need BYOK — ollama is self-hosted/local and excluded
-- (a tenant's own Ollama instance isn't reachable from this server anyway).
-- One row per (tenant, provider); deleting a row means "no key" for that
-- provider — the app must fail honestly, never fall back to a shared key.
-- RLS follows the same is_tenant_member(tenant_id) pattern every other
-- tenant-scoped table uses (20260819140000).
--
-- Part 2: app_settings RLS tightening. Confirmed via a live pg_policies
-- read while scoping M7-09: the S0-03 "containment" pass
-- (20260829120000) scoped app_settings to `authenticated` but never to a
-- specific tenant — ANY authenticated user (any future client tenant,
-- not just the internal/admin one) can currently read and write the
-- shared provider-key singleton row. This was a live credential-exposure
-- gap independent of BYOK, but directly compounds with it: once
-- tenant_provider_keys exists, app_settings' only remaining legitimate
-- purpose is the internal/admin tenant's own grandfathered configuration
-- (see M7-09's scoping notes) — restricting it to internal-tenant
-- membership only is now both correct and necessary, not just stricter.
-- Same defensive drop-all-then-recreate pattern as 20260829120000 (never
-- trust the migration chain's history to know what's actually live).

-- ---- Part 1: tenant_provider_keys ----

CREATE TABLE IF NOT EXISTS tenant_provider_keys (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('gemini', 'groq', 'nvidia', 'openrouter')),
  api_key     text NOT NULL,
  model       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tenant_provider_keys_tenant ON tenant_provider_keys(tenant_id);

ALTER TABLE tenant_provider_keys ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'tenant_provider_keys' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON tenant_provider_keys', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "tenant_provider_keys_select_members" ON tenant_provider_keys
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "tenant_provider_keys_insert_members" ON tenant_provider_keys
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "tenant_provider_keys_update_members" ON tenant_provider_keys
  FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "tenant_provider_keys_delete_members" ON tenant_provider_keys
  FOR DELETE TO authenticated USING (is_tenant_member(tenant_id));

-- ---- Part 2: app_settings RLS tightening (internal tenant only) ----

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'app_settings' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app_settings', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "app_settings_internal_tenant_select" ON app_settings
  FOR SELECT TO authenticated USING (is_tenant_member('00000000-0000-0000-0000-000000000001'::uuid));
CREATE POLICY "app_settings_internal_tenant_insert" ON app_settings
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member('00000000-0000-0000-0000-000000000001'::uuid));
CREATE POLICY "app_settings_internal_tenant_update" ON app_settings
  FOR UPDATE TO authenticated USING (is_tenant_member('00000000-0000-0000-0000-000000000001'::uuid))
  WITH CHECK (is_tenant_member('00000000-0000-0000-0000-000000000001'::uuid));

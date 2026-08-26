// Credential service — the ONLY place that reads the n8n API key.
// Loads config from app_settings (single source of truth) using the service
// role. The key never leaves this module in plaintext; callers receive a
// ready-to-use N8nConfig object. Designed so OAuth can be added later by
// extending resolveCredentials() without touching callers.

import { createClient } from "jsr:@supabase/supabase-js@2";
import type { N8nConfig } from "./types.ts";

declare global {
  const Deno: {
    env: { get(name: string): string | undefined };
  };
}

interface SettingsRow {
  n8n_url: string | null;
  n8n_api_key: string | null;
  n8n_timeout: number | null;
  n8n_retry_count: number | null;
  n8n_ssl_verify: boolean | null;
}

function getAdmin() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase service role credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Load n8n config from the database. Throws if the URL is missing — the
 * caller surfaces a friendly error. The API key may be empty for n8n
 * instances that run without auth.
 */
export async function resolveCredentials(): Promise<N8nConfig> {
  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("n8n_url, n8n_api_key, n8n_timeout, n8n_retry_count, n8n_ssl_verify")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Failed to read n8n settings: ${error.message}`);
  const row = (data ?? {}) as Partial<SettingsRow>;

  const url = (row.n8n_url ?? "").trim().replace(/\/$/, "");
  if (!url) throw new Error("No n8n URL configured. Add it in Settings.");

  return {
    url,
    apiKey: row.n8n_api_key ?? "",
    timeout: row.n8n_timeout ?? 30000,
    retryCount: row.n8n_retry_count ?? 3,
    sslVerify: row.n8n_ssl_verify ?? true,
  };
}

/**
 * Persist a connection status snapshot back to app_settings so the frontend
 * can display the last known state without re-testing.
 */
export async function saveConnectionStatus(status: string): Promise<void> {
  const supabase = getAdmin();
  await supabase
    .from("app_settings")
    .update({ n8n_connection_status: status, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

// Future OAuth support: extend resolveCredentials() to exchange a stored
// refresh token for an access token here. The N8nConfig shape stays the same;
// callers are unaware of the auth mechanism.

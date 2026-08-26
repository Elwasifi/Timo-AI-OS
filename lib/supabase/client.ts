import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing env vars — client will not function');
}

// V1: RLS is now authenticated-only (see supabase/migrations/20260819140000_*).
//
// In the browser, this client carries the signed-in user's session (set by
// authStore), so every existing service file (missionService,
// agentRegistryService, memoryStore, ...) keeps working unchanged — the
// call is scoped by RLS to that user's tenant(s) automatically.
//
// Server-side (Next.js API routes, the task-queue processor), there is no
// browser session to carry. Using the anon key there would make every one
// of those same service files fail under RLS (no authenticated role). To
// avoid a broad refactor of every DB-calling function to accept an
// injectable client, this single module is context-aware instead: when
// executed server-side AND SUPABASE_SERVICE_ROLE_KEY is configured, it
// uses the service-role key (bypasses RLS, same trust level Edge Functions
// already run at). SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix,
// so Next.js never inlines its value into the browser bundle — the
// `typeof window === 'undefined'` branch is genuinely unreachable client-side.
//
// IMPORTANT: because server-side code now runs with full service-role
// trust, every API route that uses this client for tenant-scoped data
// MUST perform its own authorization check (see lib/auth/apiAuth.ts) —
// RLS is no longer the backstop there.
const isServer = typeof window === 'undefined';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase =
  isServer && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });

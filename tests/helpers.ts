// Shared test helpers — M1-07. These are real integration tests against the
// live Supabase project (matching this project's "live verification, not
// typecheck-only" discipline), so this file constructs real, per-token
// Supabase clients rather than mocking anything.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const INTERNAL_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export function serviceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

export async function signInDevTester(): Promise<{ accessToken: string; userId: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL,
      password: process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD,
    }),
  }).then((r) => r.json());
  return { accessToken: res.access_token, userId: res.user.id };
}

/** Creates a throwaway auto-confirmed user, auto-provisioned into its own new tenant. */
export async function createThrowawayTenantUser(label: string): Promise<{
  userId: string;
  tenantId: string;
  accessToken: string;
  cleanup: () => Promise<void>;
}> {
  const svc = serviceRoleClient();
  const email = `${label}-${Date.now()}@example.com`;
  const password = `TestPass123!${Date.now()}`;

  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createdUser = await createRes.json();
  if (!createdUser.id) throw new Error('Failed to create throwaway user: ' + JSON.stringify(createdUser));

  const tok = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());

  const { data: member } = await svc
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', createdUser.id)
    .maybeSingle();
  if (!member) throw new Error('Throwaway user was not auto-provisioned into a tenant');

  return {
    userId: createdUser.id,
    tenantId: member.tenant_id,
    accessToken: tok.access_token,
    cleanup: async () => {
      const tenantId = member.tenant_id;
      await svc.from('tenant_entitlements').delete().eq('tenant_id', tenantId);
      await svc.from('client_profiles').delete().eq('tenant_id', tenantId);
      await svc.from('tenant_members').delete().eq('tenant_id', tenantId);
      await svc.from('tenants').delete().eq('id', tenantId);
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${createdUser.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
    },
  };
}

/** A Supabase client scoped to one user's session — respects RLS as that user, unlike the service-role client. */
export function clientAs(accessToken: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** A genuinely unauthenticated (anon-role) client — no user JWT at all. */
export function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

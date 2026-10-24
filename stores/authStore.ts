// Auth Store — V1 Corporate AI OS
//
// Holds the real Supabase Auth session and the resolved tenant context.
// Every tenant-scoped table now requires RLS authentication (see
// supabase/migrations/20260819140000_create_v1_corporate_os_foundation.sql),
// so this store is the single source of truth for "who is signed in and
// which tenant are they operating as" across the app.

import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';

export interface TenantMembership {
  tenantId: string;
  name: string;
  slug: string;
  kind: 'internal' | 'client';
  role: 'owner' | 'admin' | 'member';
}

interface AuthState {
  initialized: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  tenants: TenantMembership[];
  currentTenantId: string | null;
  error: string | null;

  init: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, companyName?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  setCurrentTenant: (tenantId: string) => void;
  refreshTenants: () => Promise<void>;
  /** M7-10b: the only place a user's real display name lives — auth.users.user_metadata.display_name, same mechanism signUp() already uses for company_name. No new table. */
  updateDisplayName: (name: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  loading: true,
  session: null,
  user: null,
  tenants: [],
  currentTenantId: null,
  error: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null });

    // TEMPORARY (local dev convenience only, see .env.local comment):
    // auto-login as a dedicated dev account instead of requiring a manual
    // sign-in. Real auth + RLS are unaffected — this just supplies a real
    // session automatically.
    //
    // M7-10: gated on NODE_ENV !== 'production' in addition to the flag
    // itself, so this can never silently take effect in a deployed/beta
    // build even if NEXT_PUBLIC_DEV_AUTO_LOGIN=true ends up baked into a
    // production .env by mistake — a real login screen must always be
    // what a deployed environment shows. The explicit console.warn below
    // is a second, loud signal during local dev (so it's never mistaken
    // for "just working" and left on by accident), not a substitute for
    // the NODE_ENV gate itself.
    const devAutoLoginRequested = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN === 'true';
    const devAutoLoginAllowed = process.env.NODE_ENV !== 'production';
    if (!data.session && devAutoLoginRequested && devAutoLoginAllowed) {
      console.warn('[authStore] DEV AUTO-LOGIN is active — real /login is bypassed. Local dev only; see .env.local.');
      const email = process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL;
      const password = process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD;
      if (email && password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) {
          const { data: retry } = await supabase.auth.getSession();
          set({ session: retry.session, user: retry.session?.user ?? null });
        } else {
          console.warn('[authStore] Dev auto-login failed:', error.message);
        }
      }
    } else if (!data.session && devAutoLoginRequested && !devAutoLoginAllowed) {
      // Should be structurally unreachable (NEXT_PUBLIC_DEV_AUTO_LOGIN
      // belongs only in a local .env.local, never a deployed build's
      // env), but if it somehow does happen, fail loudly rather than
      // silently bypassing auth in what could be a real environment.
      console.warn('[authStore] NEXT_PUBLIC_DEV_AUTO_LOGIN=true was set but NODE_ENV=production — ignoring it. Dev auto-login never applies outside local development.');
    }

    if (get().session) await get().refreshTenants();
    set({ loading: false });

    supabase.auth.onAuthStateChange(async (_event, session) => {
      set({ session, user: session?.user ?? null });
      if (session) {
        await get().refreshTenants();
      } else {
        set({ tenants: [], currentTenantId: null });
      }
    });
  },

  signInWithPassword: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signUp: async (email, password, companyName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { company_name: companyName } },
    });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, tenants: [], currentTenantId: null });
  },

  refreshTenants: async () => {
    const userId = get().user?.id;
    if (!userId) return;
    let { data, error } = await supabase
      .from('tenant_members')
      .select('tenant_id, role, tenants ( name, slug, kind )')
      .eq('user_id', userId);

    // Reliability fallback: if the signup trigger didn't provision a
    // tenant for this user (e.g. it failed, or this is a pre-V1 account),
    // repair it idempotently and re-fetch once.
    if (!error && (data?.length ?? 0) === 0) {
      await supabase.rpc('ensure_tenant_for_current_user');
      const retry = await supabase
        .from('tenant_members')
        .select('tenant_id, role, tenants ( name, slug, kind )')
        .eq('user_id', userId);
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      set({ error: error?.message ?? null });
      return;
    }

    const tenants: TenantMembership[] = data
      .filter((row): row is typeof row & { tenants: { name: string; slug: string; kind: 'internal' | 'client' } } => !!row.tenants)
      .map((row) => ({
        tenantId: row.tenant_id as string,
        role: row.role as TenantMembership['role'],
        name: row.tenants.name,
        slug: row.tenants.slug,
        kind: row.tenants.kind,
      }));

    const current = get().currentTenantId;
    const stillValid = current && tenants.some((t) => t.tenantId === current);

    set({
      tenants,
      currentTenantId: stillValid ? current : (tenants[0]?.tenantId ?? null),
    });
  },

  setCurrentTenant: (tenantId) => set({ currentTenantId: tenantId }),

  updateDisplayName: async (name) => {
    const { data, error } = await supabase.auth.updateUser({ data: { display_name: name } });
    if (error) return { error: error.message };
    set({ user: data.user });
    return { error: null };
  },

  updatePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  },
}));

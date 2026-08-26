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

    // TEMPORARY (testing only, see .env.local comment): auto-login as a
    // dedicated dev account instead of requiring a manual sign-in. Real
    // auth + RLS are unaffected — this just supplies a real session
    // automatically. Never runs unless NEXT_PUBLIC_DEV_AUTO_LOGIN=true.
    if (!data.session && process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN === 'true') {
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
}));

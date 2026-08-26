// authFetch — fetch() wrapper that attaches the signed-in user's Supabase
// access token as a Bearer header, for calling this app's own API routes
// now that they perform their own server-side authorization (see
// lib/auth/apiAuth.ts) instead of relying on RLS.

import { supabase } from '@/lib/supabase/client';

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}

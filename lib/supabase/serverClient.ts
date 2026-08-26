// Explicit service-role accessor for server-only code paths (the task
// queue processor, admin operations) that must hard-fail if
// SUPABASE_SERVICE_ROLE_KEY isn't configured, rather than silently
// degrading. lib/supabase/client.ts's shared `supabase` export already
// resolves to the service-role client automatically in any server
// context (see its comment) — this wrapper exists only to make that
// requirement explicit and loud at the one or two call sites that
// genuinely cannot function without it.
//
// NEVER import this from a 'use client' component.

import { supabase } from './client';

export function getServiceRoleClient(): typeof supabase {
  if (typeof window !== 'undefined') {
    throw new Error('getServiceRoleClient() must never be called from browser code.');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Background operations (task queue processing) cannot run without it. Set it in .env.local (and your deployment env) — never expose it to the browser.',
    );
  }
  return supabase;
}

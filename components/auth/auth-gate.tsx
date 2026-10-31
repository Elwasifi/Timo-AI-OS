'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

const PUBLIC_ROUTES = new Set(['/login']);

// M7-13b: lib/supabase/client.ts's boundedNavigatorLock now caps the one
// confirmed cause of an unbounded hang here (getSession() inside init()
// waiting forever on a stuck navigator.locks lock) at 5s — but this is a
// second, independent backstop: ANY reason `loading` never flips to
// false (a different hung query inside refreshTenants(), a network
// outage, something not yet discovered) should never leave a user
// staring at a bare spinner with no way out except guessing to hit
// reload. After this many ms, swap the silent spinner for an explicit
// message with a one-click reload.
const LOADING_TIMEOUT_MS = 10_000;

/**
 * Global auth gate. Every tenant-scoped table now requires an
 * authenticated Supabase session (RLS), so the app is unusable without
 * one — this redirects to /login rather than letting every page fail
 * individually on data fetches.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const init = useAuthStore((s) => s.init);
  const loading = useAuthStore((s) => s.loading);
  const session = useAuthStore((s) => s.session);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!loading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), LOADING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading]);

  const isPublic = PUBLIC_ROUTES.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      router.replace('/login');
    } else if (session && pathname === '/login') {
      router.replace('/dashboard');
    }
  }, [loading, session, isPublic, pathname, router]);

  if (isPublic) return <>{children}</>;

  if (loading || !session) {
    if (timedOut) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#020914] text-center">
          <p className="text-sm text-cyan-100">Reconnecting&hellip; this is taking longer than expected.</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-cyan-300/30 px-4 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-300/10"
          >
            Reload
          </button>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020914]">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
      </div>
    );
  }

  return <>{children}</>;
}

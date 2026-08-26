'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

const PUBLIC_ROUTES = new Set(['/login']);

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

  useEffect(() => {
    init();
  }, [init]);

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020914]">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
      </div>
    );
  }

  return <>{children}</>;
}

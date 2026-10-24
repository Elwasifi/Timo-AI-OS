'use client';

// M7-09 — BYOK onboarding gate. Confirmed design: a persistent prompt, not
// a hard block on page load — the page still loads, AI-dependent actions
// just stay honestly unusable (the ai-chat edge function's 401 is the
// real enforcement, lib/governance/executionMode.ts-style fail-closed;
// this banner is the UX nudge pointing at where to fix it). Mounted
// globally (components/providers.tsx) next to <ApprovalBanner /> so it's
// visible from anywhere in the app, not just Settings.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { requiresByok, hasAnyByokConfigured } from '@/lib/settings/tenantProviderKeys';

export function ByokGateBanner() {
  const tenantId = useAuthStore((s) => s.currentTenantId);
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    if (!requiresByok(tenantId)) {
      setNeedsKey(false);
      return;
    }
    let ignore = false;
    void hasAnyByokConfigured(tenantId as string).then((has) => {
      if (!ignore) setNeedsKey(!has);
    });
    return () => { ignore = true; };
    // Re-checked on tenant switch; Settings' TenantByokSection triggers a
    // full page state refresh on save, which re-mounts this via tenantId
    // being the only real trigger this banner needs.
  }, [tenantId]);

  if (!needsKey) return null;

  return (
    <div className="fixed left-1/2 top-3 z-[90] w-full max-w-md -translate-x-1/2 px-4">
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-black/90 px-4 py-2.5 shadow-lg backdrop-blur">
        <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
        <p className="flex-1 text-xs text-white/90">
          No AI provider key configured for this workspace — chat, missions, and voice won&apos;t work until you add one.
        </p>
        <Link
          href="/settings"
          className="shrink-0 rounded bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
        >
          Add key
        </Link>
      </div>
    </div>
  );
}

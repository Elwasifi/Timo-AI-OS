'use client';

// M7-04 — General confirmation/approval gate: in-context inline
// confirmation UI. Mounted globally (components/providers.tsx) so a
// pending approval — from a mission task's paused agent loop, a chat
// tool call, or agent deletion's existing destructive_action flow —
// appears wherever the user happens to be, Realtime-delivered, rather
// than requiring a trip to Settings -> Approvals (which still exists
// unchanged as a secondary surface for anything missed here).
//
// Deliberately a simple global banner, not per-page-embedded cards
// (e.g. inline inside a specific chat message bubble) — a considered
// scope simplification, not an oversight: reaching every surface an
// approval could be relevant to (chat, mission detail, voice) with truly
// inline placement would mean touching each of those UIs individually;
// one always-visible banner satisfies "pauses and waits for explicit UI
// confirmation" for all of them with a single component.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/lib/api/authFetch';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { listPendingApprovals, type ApprovalRequest } from '@/lib/governance/approvals';
import { cn } from '@/lib/utils';

const RISK_LABEL: Record<string, string> = {
  irreversible: 'Irreversible',
  reversible: 'Reversible',
};

const BLAST_LABEL: Record<string, string> = {
  self: 'Self only',
  tenant: 'Affects your workspace',
  external: 'Affects an external system',
};

export function ApprovalBanner() {
  const tenantId = useAuthStore((s) => s.currentTenantId);
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const refetch = useCallback(() => {
    listPendingApprovals(tenantId ?? undefined).then(setPending);
  }, [tenantId]);

  useRealtimeRefetch(
    [{ table: 'approval_requests', filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined }],
    refetch,
  );

  // Initial load — the Realtime subscription only fires on subsequent
  // changes, not the rows that already existed when this component mounted.
  useEffect(() => {
    refetch();
  }, [refetch]);

  const confirm = async (id: string, decision: 'approved' | 'rejected') => {
    setResolvingId(id);
    try {
      await authFetch(`/api/approvals/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      refetch();
    } finally {
      setResolvingId(null);
    }
  };

  if (pending.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {pending.map((approval) => {
        const risk = approval.payload as { riskLevel?: string; blastRadius?: string } | undefined;
        return (
          <div
            key={approval.id}
            className="rounded-lg border border-amber-500/40 bg-black/90 p-4 shadow-lg backdrop-blur"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{approval.title}</p>
                <p className="mt-1 text-xs text-white/70">{approval.detail}</p>
                {(risk?.riskLevel || risk?.blastRadius) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {risk?.riskLevel && (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          risk.riskLevel === 'irreversible' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300',
                        )}
                      >
                        {RISK_LABEL[risk.riskLevel] ?? risk.riskLevel}
                      </span>
                    )}
                    {risk?.blastRadius && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">
                        {BLAST_LABEL[risk.blastRadius] ?? risk.blastRadius}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={resolvingId === approval.id}
                onClick={() => confirm(approval.id, 'rejected')}
                className="flex items-center gap-1 rounded border border-white/20 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Reject
              </button>
              <button
                type="button"
                disabled={resolvingId === approval.id}
                onClick={() => confirm(approval.id, 'approved')}
                className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Approve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

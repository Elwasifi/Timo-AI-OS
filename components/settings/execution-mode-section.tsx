'use client';

// M7-13c-2a-3 — Settings -> Execution Mode.
//
// Shows the tenant's CURRENT execution mode (read straight from tenants.execution_mode) and, for the
// tenant OWNER only, a Demo <-> Live toggle. The server is the gate, not this component:
// POST /api/tenants/[id]/execution-mode checks the 'owner' role in tenant_members again, and since the
// 20261102120000 migration the browser has no UPDATE privilege on tenants at all. Hiding the controls
// from non-owners here is cosmetic. Nothing is optimistic: the displayed mode only changes to what the
// server's response says.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase/client';
import { authFetch } from '@/lib/api/authFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Mode = 'live' | 'sandbox' | 'simulation';

const MODE_LABEL: Record<Mode, string> = { sandbox: 'Demo', live: 'Live', simulation: 'Simulation' };

function asMode(v: unknown): Mode | null {
  return v === 'live' || v === 'sandbox' || v === 'simulation' ? v : null;
}

export function ExecutionModeSection() {
  const tenantId = useAuthStore((s) => s.currentTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [mode, setMode] = useState<Mode | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback(async () => {
    if (!tenantId || !userId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    const [tenantRes, memberRes] = await Promise.all([
      supabase.from('tenants').select('execution_mode').eq('id', tenantId).maybeSingle(),
      supabase.from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    ]);
    if (tenantRes.error || !tenantRes.data) {
      setLoadError('Could not read the current execution mode.');
    } else {
      setMode(asMode((tenantRes.data as { execution_mode: unknown }).execution_mode));
    }
    setRole(memberRes.error ? null : ((memberRes.data as { role?: string } | null)?.role ?? null));
    setLoading(false);
  }, [tenantId, userId]);

  useEffect(() => { void load(); }, [load]);

  const isOwner = role === 'owner';

  const change = async (target: 'sandbox' | 'live', confirm?: string): Promise<boolean> => {
    if (!tenantId) return false;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/tenants/${tenantId}/execution-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirm ? { mode: target, confirm } : { mode: target }),
      });
      const json = await res.json().catch(() => null);
      const next = asMode(json?.data?.mode);
      if (!res.ok || !json?.success || !next) {
        setActionError(json?.error?.message ?? `The mode could not be changed (HTTP ${res.status}).`);
        return false;
      }
      setMode(next); // what the SERVER says it is now
      setNotice(next === 'live' ? 'Switched to Live. Real actions will now run (approval gates still apply).' : 'Switched to Demo.');
      return true;
    } catch {
      setActionError('Could not reach the server. The mode was not changed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openLiveDialog = () => { setConfirmText(''); setActionError(null); setLiveDialogOpen(true); };
  const confirmLive = async () => {
    const ok = await change('live', confirmText);
    if (ok) setLiveDialogOpen(false);
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading execution mode...</div>;
  }

  return (
    <div>
      <h2 className="font-grotesk text-lg font-semibold">Execution Mode</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Decides whether Temo&rsquo;s tools act for real in this workspace.
      </p>

      {loadError && <p className="mt-4 text-sm text-red-400">{loadError}</p>}

      <div className="mt-6 max-w-xl rounded-xl border border-border/60 bg-background/40 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Current mode</span>
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold" data-testid="current-mode">
            {mode ? MODE_LABEL[mode] : 'Unknown'}
          </span>
        </div>

        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          <li><span className="font-medium text-foreground">Demo</span> &mdash; read-only tools (for example web search) run for real; anything with a side effect (sending, writing, deleting, running workflows) is only simulated.</li>
          <li><span className="font-medium text-foreground">Live</span> &mdash; real actions run. Actions that need approval still wait for it.</li>
        </ul>

        {isOwner ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || mode === 'sandbox'} onClick={() => change('sandbox')}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Use Demo
            </Button>
            <Button size="sm" variant="destructive" disabled={busy || mode === 'live'} onClick={openLiveDialog}>
              Switch to Live&hellip;
            </Button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">Only the account owner can change this.</p>
        )}

        {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
        {actionError && !liveDialogOpen && <p className="mt-3 text-sm text-red-400">{actionError}</p>}
      </div>

      <Dialog open={liveDialogOpen} onOpenChange={(o) => { if (!busy) setLiveDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-400" /> Switch to Live?</DialogTitle>
            <DialogDescription>
              In Live mode Temo&rsquo;s agents perform real actions with real consequences for this workspace. Actions that require approval
              will still wait for it. The switch is recorded in the approvals log under your name.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="live-confirm" className="text-xs text-slate-400">Type LIVE to confirm</Label>
            <Input id="live-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="mt-1" />
            {actionError && <p className="mt-2 text-sm text-red-400">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setLiveDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" disabled={busy || confirmText !== 'LIVE'} onClick={confirmLive}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Switch to Live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

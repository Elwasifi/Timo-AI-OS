'use client';

// M7-09 — BYOK (Bring Your Own Key). Rendered instead of the admin-only
// ProvidersSection (app/settings/page.tsx) for every tenant that isn't the
// grandfathered internal/admin one (lib/settings/tenantProviderKeys.ts's
// requiresByok()) — that component edits the shared app_settings
// singleton, which M7-09's RLS tightening now restricts to the internal
// tenant only, so a BYOK tenant would just see failed reads/writes there.
//
// Deliberately simpler than ProvidersSection: no active-provider selector,
// no routing preferences, no Ollama (not a BYOK provider — self-hosted,
// unreachable from this server per-tenant). Just: for each of the 4 BYOK
// providers, a masked key input, Save, Remove, and Validate (reusing the
// existing /api/settings/validate-provider route, which already resolves
// this tenant's key via tenantId).

import { useEffect, useState } from 'react';
import { Check, Loader2, Save, ShieldCheck, Trash2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { authFetch } from '@/lib/api/authFetch';
import { cn } from '@/lib/utils';
import {
  BYOK_PROVIDERS, loadTenantProviderKeys, saveTenantProviderKey, deleteTenantProviderKey,
  type ByokProviderId,
} from '@/lib/settings/tenantProviderKeys';
import { PROVIDER_LABELS, type ProviderValidationResult, type ProviderValidationStatus } from '@/lib/settings/settings-service';

const MASK = '••••••••••••••••';

type RowState = {
  configured: boolean;
  input: string;
  saving: boolean;
  validation?: { status: ProviderValidationStatus | 'validating'; message?: string };
};

export function TenantByokSection() {
  const tenantId = useAuthStore((s) => s.currentTenantId);
  const [rows, setRows] = useState<Record<ByokProviderId, RowState>>(() => {
    const init = {} as Record<ByokProviderId, RowState>;
    BYOK_PROVIDERS.forEach((p) => { init[p] = { configured: false, input: '', saving: false }; });
    return init;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) { setLoading(false); return; }
    let ignore = false;
    void loadTenantProviderKeys(tenantId).then((keys) => {
      if (ignore) return;
      const configured = new Set(keys.map((k) => k.provider));
      setRows((prev) => {
        const next = { ...prev };
        BYOK_PROVIDERS.forEach((p) => {
          next[p] = { ...next[p], configured: configured.has(p), input: configured.has(p) ? MASK : '' };
        });
        return next;
      });
      setLoading(false);
    });
    return () => { ignore = true; };
  }, [tenantId]);

  if (!tenantId) {
    return <div className="py-8 text-sm text-destructive">No workspace selected.</div>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-3 py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading your API keys...
      </div>
    );
  }

  const anyConfigured = BYOK_PROVIDERS.some((p) => rows[p].configured);

  const save = async (provider: ByokProviderId) => {
    const value = rows[provider].input;
    if (!value || value === MASK) return;
    setRows((v) => ({ ...v, [provider]: { ...v[provider], saving: true } }));
    try {
      await saveTenantProviderKey(tenantId, provider, value);
      setRows((v) => ({ ...v, [provider]: { ...v[provider], configured: true, input: MASK, saving: false } }));
    } catch (err) {
      setRows((v) => ({
        ...v,
        [provider]: { ...v[provider], saving: false, validation: { status: 'unknown_error', message: err instanceof Error ? err.message : 'Failed to save key' } },
      }));
    }
  };

  const remove = async (provider: ByokProviderId) => {
    setRows((v) => ({ ...v, [provider]: { ...v[provider], saving: true } }));
    try {
      await deleteTenantProviderKey(tenantId, provider);
      setRows((v) => ({ ...v, [provider]: { ...v[provider], configured: false, input: '', saving: false, validation: undefined } }));
    } catch (err) {
      setRows((v) => ({
        ...v,
        [provider]: { ...v[provider], saving: false, validation: { status: 'unknown_error', message: err instanceof Error ? err.message : 'Failed to remove key' } },
      }));
    }
  };

  const validate = async (provider: ByokProviderId) => {
    setRows((v) => ({ ...v, [provider]: { ...v[provider], validation: { status: 'validating' } } }));
    const raw = rows[provider].input;
    const apiKey = raw && raw !== MASK ? raw : undefined;
    try {
      const res = await authFetch('/api/settings/validate-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, tenantId }),
      });
      const envelope = await res.json().catch(() => null);
      const result: ProviderValidationResult | null = envelope?.data ?? null;
      setRows((v) => ({
        ...v,
        [provider]: {
          ...v[provider],
          validation: result ? { status: result.status, message: result.message } : { status: 'unknown_error', message: 'Validation service returned an unexpected response.' },
        },
      }));
    } catch {
      setRows((v) => ({ ...v, [provider]: { ...v[provider], validation: { status: 'unknown_error', message: 'Could not reach the validation service.' } } }));
    }
  };

  return (
    <div>
      <div>
        <h2 className="font-grotesk text-lg font-semibold">Your API Keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every workspace configures its own AI provider keys — there is no shared fallback key. Add at least one to use chat, missions, or voice.
        </p>
      </div>

      {!anyConfigured && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          No provider key configured yet — AI features (chat, missions, voice) won&apos;t work until you add at least one below.
        </div>
      )}

      <div className="mt-5 space-y-3">
        {BYOK_PROVIDERS.map((provider) => {
          const row = rows[provider];
          return (
            <div key={provider} className="rounded-xl border border-border/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{PROVIDER_LABELS[provider]}</span>
                  {row.configured && (
                    <span className="flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
                      <ShieldCheck className="h-3 w-3" /> Configured
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="password"
                  value={row.input}
                  onChange={(e) => setRows((v) => ({ ...v, [provider]: { ...v[provider], input: e.target.value } }))}
                  placeholder={`Your ${PROVIDER_LABELS[provider]} API key`}
                  className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => validate(provider)}
                  disabled={row.saving || row.validation?.status === 'validating'}
                  className="rounded-lg border border-border/60 px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {row.validation?.status === 'validating' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Validate'}
                </button>
                <button
                  type="button"
                  onClick={() => save(provider)}
                  disabled={row.saving || !row.input || row.input === MASK}
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50',
                    'bg-primary/20 text-primary hover:bg-primary/30',
                  )}
                >
                  {row.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
                {row.configured && (
                  <button
                    type="button"
                    onClick={() => remove(provider)}
                    disabled={row.saving}
                    className="flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
              {row.validation && row.validation.status !== 'validating' && (
                <div
                  className={cn(
                    'mt-2 flex items-center gap-1.5 text-xs',
                    row.validation.status === 'connected' ? 'text-success' : 'text-destructive',
                  )}
                >
                  {row.validation.status === 'connected' ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {row.validation.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

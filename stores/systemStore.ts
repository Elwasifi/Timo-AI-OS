import { create } from 'zustand';
import { authFetch } from '@/lib/api/authFetch';
import type { SystemEvent, RunningTask } from '@/types';

// M6-04: health used to be tickHealth()'s Math.random() walk — cpu/memory/
// network with no real signal behind them at all (this is a serverless
// Next.js app; there's no host process whose CPU/RAM this client could ever
// legitimately read). Removed rather than faked. What replaces it is real:
// overall system status from the already-built (but previously unwired)
// /api/runtime/health endpoint (lib/dashboard/healthService.ts — 8 real
// subsystem checks against actual tables/registries), and a real total call
// count + per-provider latency from /api/stats/providers (usage_ledger).
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number | null;
}

export interface RealSystemHealth {
  overall: HealthStatus;
  checks: HealthCheck[];
  apiCallsTotal: number;
  providerLatencyMs: Record<string, number | null>;
  fetchedAt: number;
}

interface SystemState {
  events: SystemEvent[];
  tasks: RunningTask[];
  health: RealSystemHealth | null;
  addEvent: (e: Omit<SystemEvent, 'id' | 'time'>) => void;
  updateTaskProgress: (id: string, progress: number) => void;
  fetchHealth: () => Promise<void>;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export const useSystemStore = create<SystemState>((set) => ({
  events: [
    { id: 'e1', message: 'Gemini Live API handshake successful', type: 'success', time: '09:42' },
    { id: 'e2', message: 'n8n workflow engine registered', type: 'info', time: '09:41' },
    { id: 'e3', message: 'Anthropic latency degraded (188ms)', type: 'warning', time: '09:38' },
    { id: 'e4', message: 'Daily Market Digest workflow started', type: 'info', time: '09:36' },
    { id: 'e5', message: 'Social Sentiment Scan failed at step 5', type: 'error', time: '07:52' },
  ],

  tasks: [
    { id: 't1', name: 'Daily Market Digest', progress: 64, agent: 'Nova', eta: '~2 min' },
    { id: 't2', name: 'Revenue synthesis', progress: 88, agent: 'Temo', eta: '< 1 min' },
    { id: 't3', name: 'Competitor scan', progress: 22, agent: 'Atlas', eta: '~6 min' },
  ],

  // null until the first real fetch resolves — consumers render a loading
  // state rather than a fabricated placeholder number.
  health: null,

  addEvent: (e) =>
    set((s) => ({
      events: [{ ...e, id: `e${Date.now()}`, time: now() }, ...s.events].slice(0, 20),
    })),

  updateTaskProgress: (id, progress) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, progress } : t)),
    })),

  // M7-07: root cause of the top-nav "UNKNOWN" health badge — these two
  // calls used plain fetch() against routes that require a Bearer token
  // (lib/auth/apiAuth.ts's requireUser() reads it from the Authorization
  // header only, never cookies). Live-confirmed: both requests returned
  // 401 "Sign in required" from a genuinely authenticated session,
  // because no Authorization header was ever attached — fetchHealth()
  // always fell through to its `success: false` branch, permanently
  // defaulting `overall` to 'unknown' regardless of real system health.
  // authFetch() (lib/api/authFetch.ts) is this project's existing
  // wrapper for exactly this — attaches the signed-in user's access
  // token automatically.
  fetchHealth: async () => {
    const [healthRes, providersRes] = await Promise.allSettled([
      authFetch('/api/runtime/health').then(
        (r) => r.json() as Promise<ApiEnvelope<{ overall: HealthStatus; checks: HealthCheck[] }>>,
      ),
      authFetch('/api/stats/providers').then(
        (r) => r.json() as Promise<ApiEnvelope<{ stats: { providerId: string; usageCount: number; latencyMs: number | null }[] }>>,
      ),
    ]);

    const overall: HealthStatus =
      healthRes.status === 'fulfilled' && healthRes.value?.success ? healthRes.value.data.overall : 'unknown';
    const checks: HealthCheck[] =
      healthRes.status === 'fulfilled' && healthRes.value?.success ? healthRes.value.data.checks : [];

    const providerStats =
      providersRes.status === 'fulfilled' && providersRes.value?.success ? providersRes.value.data.stats : [];
    const apiCallsTotal = providerStats.reduce((sum, p) => sum + p.usageCount, 0);
    const providerLatencyMs: Record<string, number | null> = {};
    for (const p of providerStats) providerLatencyMs[p.providerId] = p.latencyMs;

    set({ health: { overall, checks, apiCallsTotal, providerLatencyMs, fetchedAt: Date.now() } });
  },
}));

// ---- Single shared poller (de-duplicates what used to be two separate
// setInterval calls — system-footer.tsx at 2.5s and right-sidebar.tsx at
// 3s, each independently random-walking its own copy of fake numbers).
// Real health data doesn't need sub-3-second refresh, and this now does
// real DB-backed queries — 30s matches this codebase's existing polling
// cadence for comparable dashboard data (components/crew/temo-core-
// ecosystem.tsx's satellite stats). Started once, app-wide, from
// components/providers.tsx's existing mount effect. ----
let pollingStarted = false;

export function startSystemHealthPolling(): void {
  if (pollingStarted) return;
  pollingStarted = true;
  void useSystemStore.getState().fetchHealth();
  setInterval(() => void useSystemStore.getState().fetchHealth(), 30000);
}

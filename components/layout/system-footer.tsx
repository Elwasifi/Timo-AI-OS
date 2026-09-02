'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Server } from 'lucide-react';
import { useSystemStore, startSystemHealthPolling } from '@/stores/systemStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { cn } from '@/lib/utils';

export function SystemFooter() {
  const health = useSystemStore((s) => s.health);
  const providers = useDashboardStore((s) => s.providers);
  const currentId = useDashboardStore((s) => s.currentProviderId);
  const current = providers.find((p) => p.id === currentId) ?? providers[0];

  // M6-04: real data now, single shared poller (see systemStore.ts) —
  // module-level guard means this and right-sidebar.tsx's identical call
  // start at most one interval between them, not two independent ones.
  useEffect(() => {
    startSystemHealthPolling();
  }, []);

  const realLatency = health?.providerLatencyMs[current.id];
  const latencyMs = realLatency ?? current.latency;

  const statusColor = health?.overall === 'healthy' ? 'text-success' : health?.overall === 'degraded' ? 'text-warning' : health?.overall === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const statusLabel = health?.overall ? health.overall.toUpperCase() : 'CHECKING…';
  const statusDot = health?.overall === 'healthy' ? 'bg-success animate-pulse' : health?.overall === 'degraded' ? 'bg-warning animate-pulse' : health?.overall === 'down' ? 'bg-destructive' : 'bg-muted-foreground';

  return (
    <div className="flex h-7 items-center gap-4 border-t border-border/30 px-3 text-[10px] text-muted-foreground glass-panel">
      {/* Provider */}
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: current.color, boxShadow: `0 0 4px ${current.color}` }} />
        <Server className="h-3 w-3" />
        <span className="font-medium text-foreground">{current.name}</span>
        {latencyMs != null && <span className="text-muted-foreground">{latencyMs}ms</span>}
      </div>

      <div className="h-3 w-px bg-border/40" />

      {/* API calls — real total from usage_ledger (/api/stats/providers) */}
      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-primary" />
        <span className="text-muted-foreground">API</span>
        <span className="font-semibold tabular-nums text-primary">
          {health ? health.apiCallsTotal.toLocaleString() : '—'}
        </span>
      </div>

      {/* Data stream animation */}
      <div className="relative ml-auto h-1 w-32 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="absolute h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent"
          animate={{ x: ['-33%', '300%'] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Status — real overall system health from /api/runtime/health */}
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
        <span className={cn('font-medium', statusColor)}>{statusLabel}</span>
      </div>
    </div>
  );
}

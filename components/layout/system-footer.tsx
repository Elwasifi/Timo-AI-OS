'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Cpu, MemoryStick, Wifi, Server, Activity } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { cn } from '@/lib/utils';

export function SystemFooter() {
  const health = useSystemStore((s) => s.health);
  const tickHealth = useSystemStore((s) => s.tickHealth);
  const providers = useDashboardStore((s) => s.providers);
  const currentId = useDashboardStore((s) => s.currentProviderId);
  const current = providers.find((p) => p.id === currentId) ?? providers[0];

  useEffect(() => {
    const t = setInterval(tickHealth, 2500);
    return () => clearInterval(t);
  }, [tickHealth]);

  return (
    <div className="flex h-7 items-center gap-4 border-t border-border/30 px-3 text-[10px] text-muted-foreground glass-panel">
      {/* Provider */}
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: current.color, boxShadow: `0 0 4px ${current.color}` }} />
        <Server className="h-3 w-3" />
        <span className="font-medium text-foreground">{current.name}</span>
        <span className="text-muted-foreground">{current.latency}ms</span>
      </div>

      <div className="h-3 w-px bg-border/40" />

      {/* Metrics */}
      <Metric icon={Cpu} label="CPU" value={health.cpu} />
      <Metric icon={MemoryStick} label="RAM" value={health.memory} />
      <Metric icon={Wifi} label="NET" value={health.network} />

      <div className="h-3 w-px bg-border/40" />

      {/* API calls */}
      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-primary" />
        <span className="text-muted-foreground">API</span>
        <span className="font-semibold tabular-nums text-primary">{health.apiCalls.toLocaleString()}</span>
      </div>

      {/* Data stream animation */}
      <div className="relative ml-auto h-1 w-32 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="absolute h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent"
          animate={{ x: ['-33%', '300%'] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
        <span className="font-medium text-success">ONLINE</span>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: number }) {
  const color = value > 80 ? 'text-warning' : value > 60 ? 'text-primary' : 'text-muted-foreground';
  return (
    <div className="flex items-center gap-1">
      <Icon className={cn('h-3 w-3', color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold tabular-nums', color)}>{value}%</span>
    </div>
  );
}

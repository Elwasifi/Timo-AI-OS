'use client';

import { memo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Cpu,
  MemoryStick,
  Wifi,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Brain,
  ArrowRight,
  Mic,
  Bell,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useUIStore } from '@/stores/uiStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { AgentAvatar } from '@/components/crew/agent-avatar';
import { ToolExecutionTimeline } from '@/components/tools/tool-execution-timeline';
import { ClientTime } from '@/components/temo/client-time';
import { cn } from '@/lib/utils';

const FEED_ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  routing: { Icon: ArrowRight, color: 'text-primary' },
  voice: { Icon: Mic, color: 'text-secondary' },
  task: { Icon: Zap, color: 'text-success' },
  error: { Icon: XCircle, color: 'text-destructive' },
  notification: { Icon: Bell, color: 'text-warning' },
  system: { Icon: Info, color: 'text-primary' },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function RightSidebar() {
  const open = useUIStore((s) => s.rightSidebarOpen);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="relative z-20 hidden h-full flex-col glass-strong border-l border-border/60 lg:flex"
        >
          <div className="scrollbar-thin flex h-full flex-col gap-4 overflow-y-auto p-4">
            <CrewStatusSection />
            <CurrentAgentSection />
            <Section title="Tool Activity" icon={Wrench}>
              <ToolExecutionTimeline />
            </Section>
            <ActivityFeedSection />
            <CurrentProviderSection />
            <ConnectionStatusSection />
            <RunningTasksSection />
            <SystemHealthSection />
            <RecentEventsSection />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/* ── Isolated sections — each subscribes only to its own store slices ── */

const CrewStatusSection = memo(function CrewStatusSection() {
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const previousAgentId = useOrchestrationStore((s) => s.previousAgentId);
  const taskQueue = useOrchestrationStore((s) => s.taskQueue);
  const completedTasks = useOrchestrationStore((s) => s.completedTasks);
  const agents = useDashboardStore((s) => s.agents);

  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const previousAgent = previousAgentId ? agents.find((a) => a.id === previousAgentId) : null;
  const availableCount = agents.filter((a) => a.status === 'available').length;

  return (
    <Section title="Crew Status" icon={Activity}>
      <div className="glass rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Active Agent</span>
          <span className="text-xs font-medium" style={{ color: activeAgent?.color }}>
            {activeAgent?.name ?? 'Temo'}
          </span>
        </div>
        {previousAgent && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Previous</span>
            <span className="text-xs text-muted-foreground">{previousAgent.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Available</span>
          <span className="text-xs font-medium text-success">{availableCount}/{agents.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Task Queue</span>
          <span className="text-xs font-medium text-foreground">{taskQueue.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Completed</span>
          <span className="text-xs font-medium text-foreground">{completedTasks.length}</span>
        </div>
      </div>
    </Section>
  );
});

const CurrentAgentSection = memo(function CurrentAgentSection() {
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const agents = useDashboardStore((s) => s.agents);
  const activeAgent = agents.find((a) => a.id === activeAgentId);

  if (!activeAgent) return null;

  return (
    <Section title="Current Agent" icon={Brain}>
      <div className="glass rounded-xl p-3">
        <div className="flex items-center gap-3">
          <AgentAvatar
            agentId={activeAgent.id}
            iconName={activeAgent.icon}
            color={activeAgent.color}
            state="idle"
            size={40}
          />
          <div className="flex-1">
            <div className="text-sm font-semibold">{activeAgent.name}</div>
            <div className="text-xs text-muted-foreground">{activeAgent.role}</div>
          </div>
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              activeAgent.status === 'available' && 'bg-success',
              activeAgent.status === 'busy' && 'bg-warning',
              activeAgent.status === 'thinking' && 'bg-secondary',
              activeAgent.status === 'speaking' && 'bg-primary',
              activeAgent.status === 'offline' && 'bg-muted-foreground'
            )}
          />
        </div>
      </div>
    </Section>
  );
});

const ActivityFeedSection = memo(function ActivityFeedSection() {
  const activityFeed = useOrchestrationStore((s) => s.activityFeed);

  return (
    <Section title="Activity Feed" icon={Zap}>
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {activityFeed.slice(0, 12).map((item) => {
            const { Icon, color } = FEED_ICONS[item.type] ?? FEED_ICONS.system;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs"
              >
                <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', color)} />
                <div className="flex-1">
                  <span className="text-foreground">{item.title}</span>
                  {item.detail && (
                    <span className="block text-[10px] text-muted-foreground">{item.detail}</span>
                  )}
                  <ClientTime ts={item.timestamp} fmt="relative" className="text-[9px] text-muted-foreground/60" />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Section>
  );
});

const CurrentProviderSection = memo(function CurrentProviderSection() {
  const providers = useDashboardStore((s) => s.providers);
  const currentId = useDashboardStore((s) => s.currentProviderId);
  const current = providers.find((p) => p.id === currentId) ?? providers[0];

  if (!current) return null;

  return (
    <Section title="Current Provider" icon={Radio}>
      <div className="glass rounded-xl p-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold"
            style={{ backgroundColor: `${current.color}25`, color: current.color }}
          >
            {current.name[0]}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">{current.name}</div>
            <div className="text-xs text-muted-foreground">{current.model}</div>
          </div>
          <StatusDot status={current.status} />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Latency</span>
          <span className="font-medium tabular-nums text-foreground">{current.latency}ms</span>
        </div>
      </div>
    </Section>
  );
});

const ConnectionStatusSection = memo(function ConnectionStatusSection() {
  const providers = useDashboardStore((s) => s.providers);

  return (
    <Section title="Connection Status" icon={Activity}>
      <div className="space-y-2">
        {providers.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}` }}
              />
              <span className="font-medium">{p.name}</span>
            </div>
            <span className="text-xs text-muted-foreground">{p.latency}ms</span>
          </div>
        ))}
      </div>
    </Section>
  );
});

const RunningTasksSection = memo(function RunningTasksSection() {
  const tasks = useSystemStore((s) => s.tasks);

  return (
    <Section title="Running Tasks" icon={Zap}>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="glass rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{task.name}</span>
              <span className="text-[10px] text-muted-foreground">{task.eta}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                  animate={{ width: `${task.progress}%` }}
                  transition={{ type: 'spring', stiffness: 120 }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {task.progress}%
              </span>
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">by {task.agent}</div>
          </div>
        ))}
      </div>
    </Section>
  );
});

const SystemHealthSection = memo(function SystemHealthSection() {
  const health = useSystemStore((s) => s.health);
  const tickHealth = useSystemStore((s) => s.tickHealth);

  useEffect(() => {
    const t = setInterval(tickHealth, 3000);
    return () => clearInterval(t);
  }, [tickHealth]);

  return (
    <Section title="System Health" icon={Cpu}>
      <div className="glass rounded-xl p-3 space-y-3">
        <HealthBar icon={Cpu} label="CPU" value={health.cpu} />
        <HealthBar icon={MemoryStick} label="Memory" value={health.memory} />
        <HealthBar icon={Wifi} label="Network" value={health.network} />
        <div className="flex items-center justify-between border-t border-border/40 pt-2 text-xs">
          <span className="text-muted-foreground">API Calls Today</span>
          <span className="font-semibold tabular-nums text-primary">
            {health.apiCalls.toLocaleString()}
          </span>
        </div>
      </div>
    </Section>
  );
});

const RecentEventsSection = memo(function RecentEventsSection() {
  const events = useSystemStore((s) => s.events);

  return (
    <Section title="Recent Events" icon={Info}>
      <div className="space-y-1.5">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
            <EventIcon type={e.type} />
            <div className="flex-1">
              <span className="text-foreground">{e.message}</span>
              <span className="ml-2 text-muted-foreground">{e.time}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
});

/* ── Shared presentational helpers (unchanged) ── */

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'active' ? 'bg-success' : status === 'idle' ? 'bg-muted-foreground' : 'bg-destructive';
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', color)} />
      <span className="text-[10px] capitalize text-muted-foreground">{status}</span>
    </div>
  );
}

function HealthBar({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: number;
}) {
  const color =
    value > 80 ? 'from-warning to-destructive' : value > 60 ? 'from-primary to-warning' : 'from-primary to-secondary';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className="tabular-nums font-medium">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r', color)}
          animate={{ width: `${value}%` }}
          transition={{ type: 'spring', stiffness: 120 }}
        />
      </div>
    </div>
  );
}

function EventIcon({ type }: { type: string }) {
  const map = {
    success: { Icon: CheckCircle2, color: 'text-success' },
    warning: { Icon: AlertTriangle, color: 'text-warning' },
    error: { Icon: XCircle, color: 'text-destructive' },
    info: { Icon: Info, color: 'text-primary' },
  } as const;
  const { Icon, color } = map[type as keyof typeof map] ?? map.info;
  return <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', color)} />;
}

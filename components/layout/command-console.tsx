'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Mic, Zap, Radio, Database, Plug, ListTodo, BarChart3,
  Cpu, MemoryStick, Wifi, CheckCircle2, AlertTriangle, XCircle, Info,
  ChevronRight, type LucideIcon,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { cn } from '@/lib/utils';

type ConsoleView = 'agents' | 'voice' | 'workflow' | 'api' | 'memory' | 'plugins' | 'queue' | 'metrics';

const VIEWS: { key: ConsoleView; label: string; icon: LucideIcon }[] = [
  { key: 'agents', label: 'Agents', icon: Activity },
  { key: 'voice', label: 'Voice', icon: Mic },
  { key: 'workflow', label: 'Workflow', icon: Zap },
  { key: 'queue', label: 'Queue', icon: ListTodo },
  { key: 'api', label: 'API', icon: Radio },
  { key: 'memory', label: 'Memory', icon: Database },
  { key: 'plugins', label: 'Plugins', icon: Plug },
  { key: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export function CommandConsole() {
  const [activeView, setActiveView] = useState<ConsoleView>('agents');

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border/30 px-2 pt-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setActiveView(v.key)}
            className={cn(
              'group relative flex items-center gap-1.5 rounded-t-lg px-2.5 py-2 text-[10px] font-medium transition-colors',
              activeView === v.key
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <v.icon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{v.label}</span>
            {activeView === v.key && (
              <motion.div
                layoutId="console-tab"
                className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-primary glow-sm-primary"
              />
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeView === 'agents' && <AgentsView />}
            {activeView === 'voice' && <VoiceView />}
            {activeView === 'workflow' && <WorkflowView />}
            {activeView === 'queue' && <QueueView />}
            {activeView === 'api' && <ApiView />}
            {activeView === 'memory' && <MemoryView />}
            {activeView === 'plugins' && <PluginsView />}
            {activeView === 'metrics' && <MetricsView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Agents View ──
function AgentsView() {
  const agents = useDashboardStore((s) => s.agents);
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);

  return (
    <div className="space-y-2">
      {agents.map((a) => {
        const isActive = activeAgentId === a.id;
        return (
          <div
            key={a.id}
            className={cn(
              'rounded-xl border p-2.5 transition-all',
              isActive ? 'border-primary/30 bg-primary/5' : 'border-border/30 bg-white/[0.02]'
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold"
                style={{ backgroundColor: `${a.color}20`, color: a.color, boxShadow: isActive ? `0 0 8px ${a.color}40` : 'none' }}
              >
                {a.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{a.name}</span>
                  {isActive && (
                    <motion.span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: a.color }}
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">{a.currentActivity}</div>
              </div>
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  a.status === 'available' && 'bg-success',
                  a.status === 'busy' && 'bg-warning',
                  a.status === 'thinking' && 'bg-secondary',
                  a.status === 'speaking' && 'bg-primary',
                  a.status === 'offline' && 'bg-muted-foreground'
                )}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Voice View ──
function VoiceView() {
  const { orbState, isListening, isMuted, volume, transcript, interimTranscript, activeAgentId } = useVoiceStore();
  const agents = useDashboardStore((s) => s.agents);
  const activeAgent = agents.find((a) => a.id === activeAgentId);

  return (
    <div className="space-y-3">
      <div className="glass rounded-xl p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Voice Status</span>
          <span className={cn('text-[10px] font-medium', isMuted ? 'text-destructive' : 'text-success')}>
            {isMuted ? 'MUTED' : 'ACTIVE'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'h-10 w-10 rounded-full flex items-center justify-center',
              orbState === 'listening' && 'bg-primary/20 animate-pulse-glow',
              orbState === 'thinking' && 'bg-secondary/20',
              orbState === 'speaking' && 'bg-primary/20',
              orbState === 'idle' && 'bg-white/5',
            )}
          >
            <Mic className={cn('h-4 w-4', orbState === 'listening' ? 'text-primary' : 'text-muted-foreground')} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium capitalize text-foreground">{orbState}</div>
            <div className="text-[10px] text-muted-foreground">Agent: {activeAgent?.name}</div>
          </div>
        </div>
        {/* Volume meter */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
            animate={{ width: `${volume * 100}%` }}
          />
        </div>
      </div>

      {(transcript || interimTranscript) && (
        <div className="glass rounded-xl p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Live Transcript</span>
          <p className="mt-1.5 text-sm text-foreground">{transcript || interimTranscript}</p>
        </div>
      )}
    </div>
  );
}

// ── Workflow View ──
function WorkflowView() {
  const workflows = useDashboardStore((s) => s.workflows);

  return (
    <div className="space-y-2">
      {workflows.map((w) => (
        <div key={w.id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{w.name}</span>
            <StatusBadge status={w.status} />
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className={cn(
                'h-full rounded-full',
                w.status === 'error' ? 'bg-destructive' : 'bg-gradient-to-r from-primary to-secondary'
              )}
              animate={{ width: `${w.progress}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{w.steps} steps</span>
            <span>{w.lastRun}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Queue View ──
function QueueView() {
  const tasks = useSystemStore((s) => s.tasks);

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">{t.name}</span>
            <span className="text-[10px] text-muted-foreground">{t.eta}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
              animate={{ width: `${t.progress}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">by {t.agent}</div>
        </div>
      ))}
    </div>
  );
}

// ── API View ──
function ApiView() {
  const providers = useDashboardStore((s) => s.providers);
  const currentId = useDashboardStore((s) => s.currentProviderId);

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <div
          key={p.id}
          className={cn(
            'glass rounded-xl p-3 transition-all',
            p.id === currentId && 'border border-primary/30 bg-primary/5'
          )}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}` }} />
            <span className="flex-1 text-xs font-medium text-foreground">{p.name}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{p.latency}ms</span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">{p.model}</div>
        </div>
      ))}
    </div>
  );
}

// ── Memory View ──
function MemoryView() {
  const agents = useDashboardStore((s) => s.agents);

  return (
    <div className="space-y-2">
      {agents.map((a) => (
        <div key={a.id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: a.color }}>{a.name}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{a.memory.conversationCount} interactions</span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">{a.memory.lastInteraction}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {a.memory.topics.map((t) => (
              <span key={t} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Plugins View ──
function PluginsView() {
  const services = useDashboardStore((s) => s.services);

  return (
    <div className="space-y-2">
      {services.map((s) => (
        <div key={s.id} className="glass rounded-xl p-3">
          <div className="flex items-center gap-2">
            <PlugIcon status={s.status} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground">{s.name}</div>
              <div className="text-[10px] text-muted-foreground">{s.category}</div>
            </div>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase',
                s.status === 'connected' && 'bg-success/15 text-success',
                s.status === 'warning' && 'bg-warning/15 text-warning',
                s.status === 'disconnected' && 'bg-destructive/15 text-destructive'
              )}
            >
              {s.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Metrics View ──
function MetricsView() {
  const health = useSystemStore((s) => s.health);
  const events = useSystemStore((s) => s.events);

  return (
    <div className="space-y-3">
      {/* M6-04: cpu/memory/network were a fake Math.random() walk with no
          real signal behind them — removed rather than faked. See
          stores/systemStore.ts. */}
      <div className="glass rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">System Status</span>
          <span className="font-semibold uppercase text-primary">{health?.overall ?? 'unknown'}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border/30 pt-2 text-xs">
          <span className="text-muted-foreground">API Calls</span>
          <span className="font-semibold tabular-nums text-primary">{health ? health.apiCallsTotal.toLocaleString() : '—'}</span>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Event Log</div>
        <div className="space-y-1.5">
          {events.slice(0, 6).map((e) => (
            <div key={e.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
              <EventIcon type={e.type} />
              <div className="flex-1">
                <span className="text-foreground">{e.message}</span>
                <span className="ml-1.5 text-muted-foreground">{e.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-primary/15 text-primary',
    idle: 'bg-white/5 text-muted-foreground',
    paused: 'bg-warning/15 text-warning',
    error: 'bg-destructive/15 text-destructive',
  };
  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase', map[status] ?? map.idle)}>
      {status}
    </span>
  );
}

function MetricBar({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: number }) {
  const color = value > 80 ? 'from-warning to-destructive' : value > 60 ? 'from-primary to-warning' : 'from-primary to-secondary';
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
        <motion.div className={cn('h-full rounded-full bg-gradient-to-r', color)} animate={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function PlugIcon({ status }: { status: string }) {
  const color = status === 'connected' ? 'text-success' : status === 'warning' ? 'text-warning' : 'text-destructive';
  return <Plug className={cn('h-3.5 w-3.5', color)} />;
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

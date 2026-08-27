'use client';

// Command Center operational widgets — grouped per the UI-consolidation
// brief's "Core Operations / Live System / Intelligence / Automation"
// taxonomy. Every widget here reads real data from lib/dashboard's
// service layer (dashboardService.ts / healthService.ts), which already
// existed, fully built, but was never wired into any page — building
// these widgets is a connection job, not a new backend.
//
// Diagnostics/Logs/Properties are deliberately NOT duplicated here — they
// already have a real, working home in RightContextPanel (right-panel.tsx),
// mounted once by CommandDeck itself. Adding a second copy in this grid
// would be exactly the kind of redundant UI this pass is meant to remove.

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Brain, ListChecks, Radio, Workflow as WorkflowIcon } from 'lucide-react';
import { Panel } from './command-deck';
import { useDashboardStore } from '@/stores/dashboardStore';
import {
  getTaskQueueSummary,
  getCurrentActiveMission,
  getExecutionStats,
  getMemoryStats,
  getKnowledgeStats,
  getWorkflowStats,
  getProviderStats,
  type TaskQueueSummary,
  type CurrentActiveMission,
  type ExecutionStats,
  type MemoryStats,
  type KnowledgeStats,
  type WorkflowStats,
  type ProviderStats,
} from '@/lib/dashboard/dashboardService';
import { getRuntimeActivity, type RuntimeActivityItem } from '@/lib/swarm/runtimeStore';
import { getSystemHealth, type SystemHealth } from '@/lib/dashboard/healthService';

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// M4-06: every widget below used to fetch exactly once on mount with no
// revalidation — the confirmed cause of "needs a manual refresh every
// minute for things to work" (Operational Integrity Audit, section 7).
// Shared polling hook so each widget stays live without its own timer
// bookkeeping; mirrors right-sidebar.tsx's existing setInterval pattern.
const WIDGET_POLL_MS = 15_000;
function usePolled<T>(fetcher: () => Promise<T>, intervalMs = WIDGET_POLL_MS): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetcher().then((d) => {
        if (!cancelled) setData(d);
      });
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [fetcher, intervalMs]);
  return data;
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-full mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-temo-titanium/60 first:mt-0">
      {children}
    </div>
  );
}

// ---- Active Tasks ----

function ActiveTasksWidget() {
  const router = useRouter();
  const summary = usePolled(getTaskQueueSummary);

  return (
    <Panel title="Active Tasks" className="widget">
      {!summary ? (
        <p className="widget-note">Loading...</p>
      ) : summary.total === 0 ? (
        <p className="widget-note">No active mission — no tasks in flight.</p>
      ) : (
        <div className="ops-stats">
          <b>{summary.running} <small>Running</small></b>
          <b>{summary.ready + summary.waiting} <small>Queued</small></b>
          <b>{summary.completed} <small>Done</small></b>
        </div>
      )}
      <button className="widget-link" onClick={() => router.push('/missions')}>View missions →</button>
    </Panel>
  );
}

// ---- Runtime Summary ----

function RuntimeSummaryWidget() {
  const router = useRouter();
  const active = usePolled(getCurrentActiveMission);

  return (
    <Panel title="Runtime Summary" className="widget">
      {!active ? (
        <p className="widget-note">Loading...</p>
      ) : !active.mission ? (
        <p className="widget-note">Idle — no mission currently executing.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="font-mono text-xs text-temo-led truncate">{active.mission.title}</p>
          <div className="flex items-center justify-between font-mono text-[10px] text-temo-titanium">
            <span>State: <b className="text-temo-cyan">{active.executionState}</b></span>
            <span>{active.progress}%</span>
          </div>
          <p className="font-mono text-[10px] text-temo-titanium">
            {active.tasks.length} tasks · {active.objectives.length} objectives
          </p>
          <button className="widget-link" onClick={() => router.push(`/missions/${active.mission!.id}`)}>Open mission →</button>
        </div>
      )}
    </Panel>
  );
}

// ---- Live Activity ----

const getRecentActivity = () => getRuntimeActivity(6);

function LiveActivityWidget() {
  const items = usePolled(getRecentActivity);

  return (
    <Panel title="Live Activity" className="widget">
      {!items ? (
        <p className="widget-note">Loading...</p>
      ) : items.length === 0 ? (
        <p className="widget-note">No activity recorded yet.</p>
      ) : (
        <div className="alert-list">
          {items.map((item) => (
            <div key={item.id} className="widget-activity-row">
              <Radio size={11} className="text-temo-cyan shrink-0" />
              <span className="truncate">{item.title}</span>
              <small>{timeAgo(item.createdAt)}</small>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---- System Health ----

function SystemHealthWidget() {
  const health = usePolled(getSystemHealth);
  const agents = useDashboardStore((s) => s.agents);

  const statusColor = (s: string) => (s === 'healthy' ? '#6ee7b7' : s === 'degraded' ? '#facc15' : s === 'down' ? '#f87171' : '#94a3b8');

  return (
    <Panel title="System Health" className="widget">
      {!health ? (
        <p className="widget-note">Loading...</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: statusColor(health.overall) }} />
            <span className="font-mono text-xs" style={{ color: statusColor(health.overall) }}>
              {health.overall.toUpperCase()}
            </span>
            <span className="ml-auto font-mono text-[10px] text-temo-titanium">{agents.length} agents</span>
          </div>
          {health.checks.map((c) => (
            <div key={c.name} className="flex items-center justify-between font-mono text-[10px] text-temo-titanium">
              <span>{c.name}</span>
              <span style={{ color: statusColor(c.status) }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---- API Calls / Provider Activity ----

function ApiCallsWidget() {
  const stats = usePolled(getProviderStats);

  const withUsage = (stats ?? []).filter((p) => p.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount);

  return (
    <Panel title="API Calls" className="widget">
      {!stats ? (
        <p className="widget-note">Loading...</p>
      ) : withUsage.length === 0 ? (
        <p className="widget-note">No AI provider calls recorded yet.</p>
      ) : (
        <div className="legend-list">
          {withUsage.slice(0, 4).map((p) => (
            <span key={p.providerId}>
              <i className="legend" style={{ background: p.isActive ? '#22d3ee' : '#475569' }} />
              {p.providerName} · {p.usageCount} calls{p.latencyMs != null ? ` · ${p.latencyMs}ms avg` : ''}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---- Memory ----

function MemoryWidget() {
  const router = useRouter();
  const stats = usePolled(getMemoryStats);

  return (
    <Panel title="Memory" className="widget">
      {!stats ? (
        <p className="widget-note">Loading...</p>
      ) : stats.totalMemories === 0 ? (
        <p className="widget-note">No memories stored yet.</p>
      ) : (
        <div className="ops-stats">
          <b>{stats.totalMemories} <small>Memories</small></b>
          <b>{stats.embeddings} <small>Embeddings</small></b>
          <b>{stats.links} <small>Links</small></b>
        </div>
      )}
      <button className="widget-link" onClick={() => router.push('/memory')}>Open Memory →</button>
    </Panel>
  );
}

// ---- Knowledge ----

function KnowledgeWidget() {
  const router = useRouter();
  const stats = usePolled(getKnowledgeStats);

  return (
    <Panel title="Knowledge" className="widget">
      {!stats ? (
        <p className="widget-note">Loading...</p>
      ) : stats.totalFacts === 0 ? (
        <p className="widget-note">No structured facts recorded yet.</p>
      ) : (
        <div className="ops-stats">
          <b>{stats.totalFacts} <small>Facts</small></b>
          <b>{stats.averageConfidence}% <small>Avg. Confidence</small></b>
          <b>{stats.conflicts} <small>Conflicts</small></b>
        </div>
      )}
      <button className="widget-link" onClick={() => router.push('/knowledge')}>Open Knowledge →</button>
    </Panel>
  );
}

// ---- Analytics ----

function AnalyticsWidget() {
  const router = useRouter();
  // M4-07 will parallelize getExecutionStats()'s per-mission N+1 fetch — a
  // longer interval here keeps this widget live without hammering that
  // still-sequential query every 15s in the meantime.
  const stats = usePolled(getExecutionStats, 60_000);

  return (
    <Panel title="Analytics" className="widget">
      {!stats ? (
        <p className="widget-note">Loading...</p>
      ) : stats.totalTasks === 0 ? (
        <p className="widget-note">No task history yet.</p>
      ) : (
        <div className="ops-stats">
          <b>{stats.successRate}% <small>Success Rate</small></b>
          <b>{stats.totalTasks} <small>Total Tasks</small></b>
          <b>{stats.errorRate}% <small>Error Rate</small></b>
        </div>
      )}
      <button className="widget-link" onClick={() => router.push('/analytics')}>Open Analytics →</button>
    </Panel>
  );
}

// ---- Workflows / n8n ----

function WorkflowsWidget() {
  const router = useRouter();
  const stats = usePolled(getWorkflowStats);

  return (
    <Panel title="Workflows" className="widget">
      {!stats ? (
        <p className="widget-note">Loading...</p>
      ) : stats.total === 0 ? (
        <p className="widget-note">No n8n workflows registered yet.</p>
      ) : (
        <div className="ops-stats">
          <b>{stats.active} <small>Active</small></b>
          <b>{stats.total} <small>Total</small></b>
          <b>{stats.recentExecutions} <small>Runs</small></b>
        </div>
      )}
      <button className="widget-link" onClick={() => router.push('/workflows')}>Open Workflows →</button>
    </Panel>
  );
}

// ---- Grouped export ----

export function CommandCenterWidgets({ missionWidget }: { missionWidget: ReactNode }) {
  return (
    <>
      <GroupLabel><ListChecks size={11} className="mr-1 inline" />Core Operations</GroupLabel>
      {missionWidget}
      <ActiveTasksWidget />
      <RuntimeSummaryWidget />

      <GroupLabel><Activity size={11} className="mr-1 inline" />Live System</GroupLabel>
      <LiveActivityWidget />
      <SystemHealthWidget />
      <ApiCallsWidget />

      <GroupLabel><Brain size={11} className="mr-1 inline" />Intelligence</GroupLabel>
      <MemoryWidget />
      <KnowledgeWidget />
      <AnalyticsWidget />

      <GroupLabel><WorkflowIcon size={11} className="mr-1 inline" />Automation</GroupLabel>
      <WorkflowsWidget />
    </>
  );
}

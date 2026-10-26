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
import { usePolled } from '@/lib/hooks/usePolled';
import { Activity, Brain, ListChecks, Radio, Workflow as WorkflowIcon, type LucideIcon } from 'lucide-react';
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

// M7-13 (dashboard reorganization, visual/CSS only — no data-fetching,
// Realtime wiring, or widget behavior touched by this file's changes):
// the 4-category grouping itself (Core Operations/Live System/
// Intelligence/Automation) already existed — the diagnostic found the
// gap was that it read as a continuous scroll with small text dividers,
// not 4 legible zones. WidgetGroup gives each category its own bordered
// container (see .widget-group in globals.css) instead of a bare label,
// and an anchor id for the jump nav below to target.
function WidgetGroup({ id, label, icon: Icon, children }: { id: string; label: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section id={id} className="widget-group">
      <div className="widget-group-header">
        <Icon size={12} />
        <span>{label}</span>
      </div>
      <div className="widget-group-grid">{children}</div>
    </section>
  );
}

// ---- Active Tasks ----

function ActiveTasksWidget() {
  const router = useRouter();
  // M7-12: mission_tasks is the table this actually reads (via getTasks);
  // runtime_state changes whenever a new mission becomes current, which
  // also changes which tasks this summary should reflect.
  const summary = usePolled(getTaskQueueSummary, undefined, [{ table: 'mission_tasks' }, { table: 'runtime_state' }]);

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
  // M7-12: getFullMission() reads missions/mission_objectives/mission_tasks/
  // mission_timeline for the current mission; runtime_state drives which
  // mission is "current" and its progress/executionState fields directly.
  const active = usePolled(getCurrentActiveMission, undefined, [
    { table: 'runtime_state' },
    { table: 'mission_tasks' },
    { table: 'mission_timeline' },
  ]);

  return (
    <Panel title="Runtime Summary" className="widget widget-span-2">
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
  // M7-12: getRuntimeActivity() reads runtime_activity directly.
  const items = usePolled(getRecentActivity, undefined, [{ table: 'runtime_activity' }]);

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
  // M7-12: NOT converted to Realtime — getSystemHealth() is an aggregate
  // of 8 independent subsystem checks (provider config, workflow_registry,
  // memory/knowledge tables, tool registry, missions, the in-memory agent
  // registry, runtime_state) with no single natural DB-change trigger;
  // watching all of their tables would mean resubscribing to nearly every
  // table in the schema for a widget that's explicitly a periodic health
  // probe, not a live feed. Left on the original 15s poll by design.
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
  // M7-12: usage_ledger is the real per-call data this reads; app_settings
  // changes whenever active_provider/BYOK keys are updated (M7-09).
  const stats = usePolled(getProviderStats, undefined, [{ table: 'usage_ledger' }, { table: 'app_settings' }]);

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
  // M7-12: memory.stats() reads memories/memory_embeddings/memory_links/memory_events.
  const stats = usePolled(getMemoryStats, undefined, [
    { table: 'memories' },
    { table: 'memory_embeddings' },
    { table: 'memory_links' },
    { table: 'memory_events' },
  ]);

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
  // M7-12: getKnowledgeStats() reads structured_facts.
  const stats = usePolled(getKnowledgeStats, undefined, [{ table: 'structured_facts' }]);

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
  // M7-12: getExecutionStats() now runs one batched query over mission_tasks
  // (missionService.getTasksForMissions) instead of up to 200 per-mission
  // requests — real-time-driven via mission_tasks, with the explicit 60s
  // interval kept as the safety-net cadence for this heavier aggregate.
  const stats = usePolled(getExecutionStats, 60_000, [{ table: 'mission_tasks' }]);

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
  // M7-12: workflow_registry + mission_timeline (recentExecutions counts
  // 'workflow_executed' events there).
  const stats = usePolled(getWorkflowStats, undefined, [{ table: 'workflow_registry' }, { table: 'mission_timeline' }]);

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

const JUMP_TARGETS = [
  { id: 'widget-group-operations', label: 'Operations', icon: ListChecks },
  { id: 'widget-group-system', label: 'System', icon: Activity },
  { id: 'widget-group-intelligence', label: 'Intelligence', icon: Brain },
  { id: 'widget-group-automation', label: 'Automation', icon: WorkflowIcon },
];

function WidgetJumpNav() {
  return (
    <nav className="widget-jump-nav">
      {JUMP_TARGETS.map((t) => {
        const Icon = t.icon;
        return (
          <a key={t.id} href={`#${t.id}`}>
            <Icon size={11} />
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}

export function CommandCenterWidgets({ missionWidget }: { missionWidget: ReactNode }) {
  return (
    <>
      <WidgetJumpNav />

      <WidgetGroup id="widget-group-operations" label="Core Operations" icon={ListChecks}>
        <div className="widget-span-2">{missionWidget}</div>
        <ActiveTasksWidget />
        <RuntimeSummaryWidget />
      </WidgetGroup>

      <WidgetGroup id="widget-group-system" label="Live System" icon={Activity}>
        <LiveActivityWidget />
        <SystemHealthWidget />
        <ApiCallsWidget />
      </WidgetGroup>

      <WidgetGroup id="widget-group-intelligence" label="Intelligence" icon={Brain}>
        <MemoryWidget />
        <KnowledgeWidget />
        <AnalyticsWidget />
      </WidgetGroup>

      <WidgetGroup id="widget-group-automation" label="Automation" icon={WorkflowIcon}>
        <WorkflowsWidget />
      </WidgetGroup>
    </>
  );
}

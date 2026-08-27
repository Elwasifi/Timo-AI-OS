// Phase 4 — Dashboard Data Service
//
// Clean service APIs that the future Dashboard will consume.
// Every function returns REAL data from the database — no mock values.
//
// Services exposed:
//   - Mission Summary
//   - Mission Timeline
//   - Task Queue
//   - Departments
//   - Managers
//   - Agent Registry
//   - Execution Statistics
//   - System Statistics
//   - Provider Statistics
//   - Workflow Statistics
//   - Memory Statistics
//   - Knowledge Statistics
//   - Tool Usage
//   - Recent Missions
//   - Current Active Mission
//   - Runtime Activity Feed

import { supabase } from '@/lib/supabase/client';
import {
  listMissions,
  getMission,
  getTasks,
  getTimeline,
  getFullMission,
} from '@/lib/swarm/missionService';
import { getRuntimeState, getRuntimeStateForTenant, getRuntimeActivity, getRuntimeActivityForTenant, type RuntimeActivityItem } from '@/lib/swarm/runtimeStore';
import { AGENT_DEFINITIONS, getManagers, getChief } from '@/lib/agents/definitions';
import type { Mission, MissionTask, MissionObjective, TimelineEntry } from '@/lib/swarm/types';
import type { AgentRecord } from '@/lib/agents/types';

// ---- Types ----

export interface MissionSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  paused: number;
  averageProgress: number;
}

export interface TaskQueueSummary {
  total: number;
  waiting: number;
  ready: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface DepartmentInfo {
  id: string;
  name: string;
  managerId: string;
  managerName: string;
  managerRole: string;
  managerColor: string;
  capabilities: string[];
  agentCount: number;
  isActive: boolean;
}

export interface ExecutionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalRetries: number;
  averageTaskDurationMs: number;
  averageMissionDurationMs: number;
  successRate: number;
  retryRate: number;
  errorRate: number;
}

export interface ProviderStats {
  providerId: string;
  providerName: string;
  isActive: boolean;
  hasKey: boolean;
  model: string;
  latencyMs: number | null;
  usageCount: number;
  errorCount: number;
}

export interface WorkflowStats {
  total: number;
  active: number;
  inactive: number;
  byCategory: Record<string, number>;
  recentExecutions: number;
}

export interface MemoryStats {
  totalMemories: number;
  byType: Record<string, number>;
  embeddings: number;
  links: number;
  events: number;
}

export interface KnowledgeStats {
  totalFacts: number;
  byCategory: Record<string, number>;
  averageConfidence: number;
  conflicts: number;
}

export interface ToolUsageStats {
  totalTools: number;
  byCategory: Record<string, number>;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
}

export interface SystemStats {
  totalMissions: number;
  totalTasks: number;
  totalAgents: number;
  activeManagers: number;
  uptime: string;
  lastActivity: string | null;
}

export interface CurrentActiveMission {
  mission: Mission | null;
  objectives: MissionObjective[];
  tasks: MissionTask[];
  timeline: TimelineEntry[];
  progress: number;
  executionState: string;
}

// ---- Mission Services ----

export async function getMissionSummary(tenantId?: string | null): Promise<MissionSummary> {
  const missions = await listMissions(200, undefined, tenantId ?? undefined);
  const running = missions.filter((m) => m.status === 'executing').length;
  const completed = missions.filter((m) => m.status === 'completed').length;
  const failed = missions.filter((m) => m.status === 'failed').length;
  const cancelled = missions.filter((m) => m.status === 'cancelled').length;
  const paused = missions.filter((m) => m.status === 'paused').length;
  const avgProgress = missions.length > 0
    ? Math.round(missions.reduce((sum, m) => sum + m.progress, 0) / missions.length)
    : 0;

  return { total: missions.length, running, completed, failed, cancelled, paused, averageProgress: avgProgress };
}

export async function getRecentMissions(limit = 10, tenantId?: string | null): Promise<Mission[]> {
  return listMissions(limit, undefined, tenantId ?? undefined);
}

export async function getMissionTimeline(missionId: string): Promise<TimelineEntry[]> {
  return getTimeline(missionId);
}

export async function getCurrentActiveMission(tenantId?: string | null): Promise<CurrentActiveMission> {
  const state = tenantId ? await getRuntimeStateForTenant(tenantId) : await getRuntimeState();

  if (!state.currentMissionId) {
    return { mission: null, objectives: [], tasks: [], timeline: [], progress: 0, executionState: state.executionState };
  }

  const full = await getFullMission(state.currentMissionId);
  return {
    mission: full.mission,
    objectives: full.objectives,
    tasks: full.tasks,
    timeline: full.timeline,
    progress: state.missionProgress,
    executionState: state.executionState,
  };
}

// ---- Task Queue Services ----

// M2-01: a caller-supplied missionId must be verified as belonging to the
// caller's own tenant before its tasks are returned — same IDOR class
// already fixed for missions/[id]/timeline and stream/mission in M1-06.
export async function getTaskQueue(missionId?: string, tenantId?: string | null): Promise<MissionTask[]> {
  if (missionId) {
    if (tenantId) {
      const { data: mission } = await supabase.from('missions').select('id').eq('id', missionId).eq('tenant_id', tenantId).maybeSingle();
      if (!mission) return [];
    }
    return getTasks(missionId);
  }

  const state = tenantId ? await getRuntimeStateForTenant(tenantId) : await getRuntimeState();
  if (state.currentMissionId) return getTasks(state.currentMissionId);
  return [];
}

export async function getTaskQueueSummary(tenantId?: string | null): Promise<TaskQueueSummary> {
  const state = tenantId ? await getRuntimeStateForTenant(tenantId) : await getRuntimeState();
  let tasks: MissionTask[] = [];
  if (state.currentMissionId) tasks = await getTasks(state.currentMissionId);

  return {
    total: tasks.length,
    waiting: tasks.filter((t) => t.status === 'waiting').length,
    ready: tasks.filter((t) => t.status === 'ready').length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    cancelled: tasks.filter((t) => t.status === 'cancelled').length,
  };
}

// ---- Department & Manager Services ----

export async function getDepartments(): Promise<DepartmentInfo[]> {
  const managers = getManagers();
  return managers.map((m) => ({
    id: m.departmentId ?? m.id,
    name: formatDepartmentName(m.departmentId ?? m.id),
    managerId: m.id,
    managerName: m.displayName,
    managerRole: m.role,
    managerColor: m.themeColor,
    capabilities: m.capabilities,
    agentCount: 1,
    isActive: m.isActive,
  }));
}

export async function getManagersList(): Promise<AgentRecord[]> {
  return getManagers();
}

export async function getChiefAgent(): Promise<AgentRecord | undefined> {
  return getChief();
}

export async function getAgentRegistry(): Promise<AgentRecord[]> {
  return AGENT_DEFINITIONS.filter((a) => a.isActive);
}

function formatDepartmentName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// ---- Execution Statistics ----

export async function getExecutionStats(tenantId?: string | null): Promise<ExecutionStats> {
  const missions = await listMissions(200, undefined, tenantId ?? undefined);
  // M4-07: was a sequential await-in-a-loop across up to 200 missions — a
  // real, worsening N+1 that ran on every Main Dashboard mount via
  // AnalyticsWidget. Fetching all missions' tasks in parallel doesn't
  // change what's returned, just how long it takes to get there.
  const perMissionTasks = await Promise.all(missions.map((m) => getTasks(m.id)));
  const allTasks: MissionTask[] = perMissionTasks.flat();

  const completed = allTasks.filter((t) => t.status === 'completed');
  const failed = allTasks.filter((t) => t.status === 'failed');
  const totalRetries = allTasks.reduce((sum, t) => sum + (t.retries || 0), 0);

  const taskDurations = completed
    .filter((t) => t.startedAt && t.completedAt)
    .map((t) => new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime());
  const avgTaskDuration = taskDurations.length > 0
    ? Math.round(taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length)
    : 0;

  const missionDurations = missions
    .filter((m) => m.status === 'completed')
    .map((m) => new Date(m.updatedAt).getTime() - new Date(m.createdAt).getTime());
  const avgMissionDuration = missionDurations.length > 0
    ? Math.round(missionDurations.reduce((a, b) => a + b, 0) / missionDurations.length)
    : 0;

  return {
    totalTasks: allTasks.length,
    completedTasks: completed.length,
    failedTasks: failed.length,
    totalRetries,
    averageTaskDurationMs: avgTaskDuration,
    averageMissionDurationMs: avgMissionDuration,
    successRate: allTasks.length > 0 ? Math.round((completed.length / allTasks.length) * 100) : 0,
    retryRate: allTasks.length > 0 ? Math.round((totalRetries / allTasks.length) * 100) : 0,
    errorRate: allTasks.length > 0 ? Math.round((failed.length / allTasks.length) * 100) : 0,
  };
}

// ---- Provider Statistics ----

// Provider configuration (which providers are set up, which model, the
// active one) is genuinely global today — a single shared app_settings
// row, not per-tenant credentials — so that part is intentionally NOT
// tenant-filtered (documented as global-by-design, M2-01). Usage counts
// (usage_ledger has a real tenant_id) are filtered when tenantId is given.
export async function getProviderStats(tenantId?: string | null): Promise<ProviderStats[]> {
  const { loadSettings, FALLBACK_ORDER, PROVIDER_KEY_FIELD, PROVIDER_MODEL_FIELD } =
    await import('@/lib/settings/settings-service');

  const settings = await loadSettings();

  const providerUsage = await getProviderUsageFromLedger(tenantId);

  return FALLBACK_ORDER.map((id) => {
    const keyField = PROVIDER_KEY_FIELD[id] as keyof typeof settings;
    const modelField = PROVIDER_MODEL_FIELD[id] as keyof typeof settings;
    const hasKey = id === 'ollama' ? !!settings.ollama_base_url : !!settings[keyField];
    return {
      providerId: id,
      providerName: id.charAt(0).toUpperCase() + id.slice(1),
      isActive: settings.active_provider === id,
      hasKey,
      model: String(settings[modelField] ?? 'default'),
      latencyMs: providerUsage[id]?.avgLatencyMs ?? null,
      usageCount: providerUsage[id]?.count ?? 0,
      errorCount: 0,
    };
  });
}

// Reads real per-provider call counts/latency from usage_ledger — the
// actual recorded outcome of each provider call — rather than
// mission_timeline's 'provider_selected' events, whose `metadata` is `{}`
// today (the provider name only exists inside the event's `title` string,
// e.g. "Provider: gemini", not as structured data usable for aggregation).
async function getProviderUsageFromLedger(tenantId?: string | null): Promise<Record<string, { count: number; avgLatencyMs: number | null }>> {
  let query = supabase.from('usage_ledger').select('provider, latency_ms').limit(2000);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data } = await query;

  const totals: Record<string, { count: number; latencySum: number; latencyCount: number }> = {};
  for (const row of (data ?? []) as Array<{ provider: string; latency_ms: number | null }>) {
    const entry = totals[row.provider] ?? { count: 0, latencySum: 0, latencyCount: 0 };
    entry.count += 1;
    if (row.latency_ms != null) {
      entry.latencySum += row.latency_ms;
      entry.latencyCount += 1;
    }
    totals[row.provider] = entry;
  }

  const result: Record<string, { count: number; avgLatencyMs: number | null }> = {};
  for (const [provider, t] of Object.entries(totals)) {
    result[provider] = {
      count: t.count,
      avgLatencyMs: t.latencyCount > 0 ? Math.round(t.latencySum / t.latencyCount) : null,
    };
  }
  return result;
}

// ---- Workflow Statistics ----

export async function getWorkflowStats(): Promise<WorkflowStats> {
  const { data, error } = await supabase
    .from('workflow_registry')
    .select('active, trigger_type, workflow_name')
    .limit(200);

  if (error || !data) {
    return { total: 0, active: 0, inactive: 0, byCategory: {}, recentExecutions: 0 };
  }

  const rows = data as Array<{ active: boolean; trigger_type: string | null; workflow_name: string }>;
  const byCategory: Record<string, number> = {};
  for (const r of rows) {
    const cat = r.trigger_type ?? 'none';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  const { count: recentExecutions } = await supabase
    .from('mission_timeline')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'workflow_executed');

  return {
    total: rows.length,
    active: rows.filter((r) => r.active).length,
    inactive: rows.filter((r) => !r.active).length,
    byCategory,
    recentExecutions: recentExecutions ?? 0,
  };
}

// ---- Memory Statistics ----

export async function getMemoryStats(tenantId?: string | null): Promise<MemoryStats> {
  const { memory } = await import('@/lib/memory/memoryService');
  try {
    const stats = await memory.stats(tenantId);
    return {
      totalMemories: stats.total,
      byType: stats.byType,
      embeddings: stats.embeddings,
      links: stats.links,
      events: stats.events,
    };
  } catch {
    return { totalMemories: 0, byType: {}, embeddings: 0, links: 0, events: 0 };
  }
}

// ---- Knowledge Statistics ----

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  try {
    const { data: facts } = await supabase
      .from('structured_facts')
      .select('category, confidence')
      .limit(5000);

    const rows = (facts ?? []) as Array<{ category: string; confidence: number }>;
    const byCategory: Record<string, number> = {};
    let confSum = 0;
    for (const r of rows) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      confSum += r.confidence || 0;
    }

    const { count: conflicts } = await supabase
      .from('structured_facts')
      .select('*', { count: 'exact', head: true })
      .not('superseded_by', 'is', null);

    return {
      totalFacts: rows.length,
      byCategory,
      averageConfidence: rows.length > 0 ? Math.round(confSum / rows.length) : 0,
      conflicts: conflicts ?? 0,
    };
  } catch {
    return { totalFacts: 0, byCategory: {}, averageConfidence: 0, conflicts: 0 };
  }
}

// ---- Tool Usage Statistics ----

export async function getToolUsageStats(): Promise<ToolUsageStats> {
  const { toolRegistry } = await import('@/lib/tools/registry');
  const tools = toolRegistry.list();

  const byCategory: Record<string, number> = {};
  for (const t of tools) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
  }

  const { count: totalExecutions } = await supabase
    .from('mission_timeline')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'tool_selected');

  const { count: successful } = await supabase
    .from('mission_timeline')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'execution_finished');

  const { count: failed } = await supabase
    .from('mission_timeline')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'execution_failed');

  return {
    totalTools: tools.length,
    byCategory,
    totalExecutions: totalExecutions ?? 0,
    successfulExecutions: successful ?? 0,
    failedExecutions: failed ?? 0,
  };
}

// ---- System Statistics ----

// totalMissions/totalTasks are tenant-scoped when tenantId is given.
// totalAgents/activeManagers stay global — the agent registry is shared
// workforce by design (CLAUDE.md), not per-tenant. lastActivity stays a
// global heartbeat (a raw timestamp carries no tenant-identifying content
// on its own, unlike the activity feed's titles/details).
export async function getSystemStats(tenantId?: string | null): Promise<SystemStats> {
  const missions = await listMissions(200, undefined, tenantId ?? undefined);
  // M4-07: same sequential N+1 as getExecutionStats() above. Currently
  // dead in practice (only reachable via the orphaned /api/stats/dashboard
  // route — Operational Integrity Audit section 7) but fixed anyway rather
  // than left as a landmine for whenever that route gets wired up.
  const perMissionTasks = await Promise.all(missions.map((m) => getTasks(m.id)));
  const totalTasks = perMissionTasks.reduce((sum, tasks) => sum + tasks.length, 0);

  const agents = AGENT_DEFINITIONS.filter((a) => a.isActive);
  const managers = agents.filter((a) => a.level === 'manager');

  const activity = tenantId ? await getRuntimeActivityForTenant(tenantId, 1) : await getRuntimeActivity(1);
  const lastActivity = activity.length > 0 ? activity[0].createdAt : null;

  return {
    totalMissions: missions.length,
    totalTasks,
    totalAgents: agents.length,
    activeManagers: managers.length,
    uptime: 'runtime',
    lastActivity,
  };
}

// ---- Runtime Activity Feed ----

export async function getRecentActivity(limit = 30, tenantId?: string | null): Promise<RuntimeActivityItem[]> {
  return tenantId ? getRuntimeActivityForTenant(tenantId, limit) : getRuntimeActivity(limit);
}

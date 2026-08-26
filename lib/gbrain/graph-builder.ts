import { AGENT_DEFINITIONS, getWorkersOf } from '@/lib/agents/definitions';
import { DEPARTMENTS } from '@/lib/agents/departments';
import type { AgentRecord } from '@/lib/agents/types';
import type { Mission, MissionTask } from '@/lib/swarm/types';
import type { Agent, ActivityFeedItem, Provider } from '@/types';
import type { GBrainGraph, GBrainNode, GBrainEdge, GBrainNodeStatus } from './layout';

// ---- Icon name mapping for entity nodes ----
const AGENT_ICON_MAP: Record<string, string> = {
  temo: 'Sparkles',
  nova: 'Code2',
  flow: 'Workflow',
  atlas: 'TrendingUp',
  luna: 'Palette',
  echo: 'PenTool',
  orion: 'LineChart',
};

// ---- Status mapping: AgentStatus → GBrainNodeStatus ----
function mapAgentStatus(
  agentStatus: string,
  isActive: boolean,
  isExecuting: boolean,
): GBrainNodeStatus {
  if (!isActive) return 'offline';
  if (isExecuting) return 'executing';
  if (agentStatus === 'thinking') return 'thinking';
  if (agentStatus === 'speaking') return 'speaking';
  if (agentStatus === 'busy') return 'working';
  if (agentStatus === 'available') return 'available';
  if (agentStatus === 'offline') return 'offline';
  return 'idle';
}

// ---- Adapt AgentRecord → Agent (runtime) ----
export function adaptRecordToAgent(rec: AgentRecord): Partial<Agent> {
  return {
    id: rec.id,
    name: rec.displayName,
    role: rec.role,
    icon: rec.avatar,
    color: rec.themeColor,
    status: rec.isActive ? 'available' : 'offline',
    description: rec.description,
    capabilities: rec.capabilities,
  };
}

export interface GraphBuilderInput {
  /** Agents from dashboardStore (runtime state with personality/voice/memory) */
  runtimeAgents: Agent[];
  /** Set of agent IDs currently executing a task */
  executingAgentIds: Set<string>;
  /** Active missions from the mission engine */
  missions: Mission[];
  /** Tasks for active missions */
  missionTasks: MissionTask[];
  /** Tools/providers from dashboardStore */
  providers: Provider[];
  /** The ID of the currently active agent (from orchestration) */
  activeAgentId: string;
  /** The ID of the currently active worker during Nova delegation, if any */
  activeWorkerId?: string | null;
}

/** Structural inputs that change rarely (agent list, providers, missions) */
export interface StaticGraphInput {
  runtimeAgents: Agent[];
  missions: Mission[];
  missionTasks: MissionTask[];
  providers: Provider[];
}

/** Volatile state that changes on every thinking/speaking/routing transition */
export interface DynamicGraphState {
  executingAgentIds: Set<string>;
  activeAgentId: string;
  activeWorkerId?: string | null;
}

export function buildGBrainGraph(input: GraphBuilderInput): GBrainGraph {
  const { runtimeAgents, missions, missionTasks, providers } = input;
  const staticGraph = buildStaticGraph({ runtimeAgents, missions, missionTasks, providers });
  return applyDynamicState(staticGraph, {
    executingAgentIds: input.executingAgentIds,
    activeAgentId: input.activeAgentId,
    activeWorkerId: input.activeWorkerId,
  });
}

/**
 * Build the graph structure with default (non-executing) node statuses.
 * Depends only on rarely-changing inputs: agent list, providers, missions.
 * Safe to memoize on long intervals.
 */
export function buildStaticGraph(input: StaticGraphInput): GBrainGraph {
  const { runtimeAgents, missions, missionTasks, providers } = input;

  const nodes: GBrainNode[] = [];
  const edges: GBrainEdge[] = [];

  // Filter to active agents only (skip Orion unless activated)
  const activeAgents = runtimeAgents.filter((a) => {
    const def = AGENT_DEFINITIONS.find((d) => d.id === a.id);
    return def ? def.isActive : true;
  });

  const chief = activeAgents.find((a) => a.id === 'temo');
  const managers = activeAgents.filter((a) => a.id !== 'temo');

  // ── Core node (Temo) — static status, dynamic overlay will update ──
  nodes.push({
    id: 'core',
    kind: 'core',
    label: 'Temo Core',
    ring: 0,
    color: chief?.color ?? '#00E5FF',
    agentId: 'temo',
    status: chief ? mapAgentStatus(chief.status, true, false) : 'idle',
    meta: chief?.role ?? 'Chief AI Coordinator',
  });

  // ── Domain: Agents ──
  const agentsDomainColor = '#7B61FF';
  nodes.push({
    id: 'agents',
    kind: 'domain',
    label: 'Agents',
    ring: 1,
    color: agentsDomainColor,
    meta: `${managers.length} specialists`,
  });
  edges.push({ source: 'core', target: 'agents', kind: 'domain' });

  // ── Domain: Missions ──
  const activeMissions = missions.filter(
    (m) => m.status === 'executing' || m.status === 'planning' || m.status === 'ready' || m.status === 'reviewing',
  );
  const missionsColor = '#10B981';
  nodes.push({
    id: 'missions',
    kind: 'domain',
    label: 'Missions',
    ring: 1,
    color: missionsColor,
    meta: activeMissions.length > 0 ? `${activeMissions.length} active` : `${missions.length} total`,
    missionId: activeMissions[0]?.id,
  });
  edges.push({ source: 'core', target: 'missions', kind: 'domain' });

  // ── Domain: Tools ──
  const activeProviders = providers.filter((p) => p.status === 'active');
  const toolsColor = '#F59E0B';
  nodes.push({
    id: 'tools',
    kind: 'domain',
    label: 'Tools',
    ring: 1,
    color: toolsColor,
    meta: `${activeProviders.length} active`,
  });
  edges.push({ source: 'core', target: 'tools', kind: 'domain' });

  // ── Domain: Memory ──
  const memoryColor = '#EC4899';
  nodes.push({
    id: 'memory',
    kind: 'domain',
    label: 'Memory',
    ring: 1,
    color: memoryColor,
    meta: 'Engine online',
  });
  edges.push({ source: 'core', target: 'memory', kind: 'domain' });

  // ── Domain: Knowledge ──
  const knowledgeColor = '#3B82F6';
  nodes.push({
    id: 'knowledge',
    kind: 'domain',
    label: 'Knowledge',
    ring: 1,
    color: knowledgeColor,
    meta: 'Engine online',
  });
  edges.push({ source: 'core', target: 'knowledge', kind: 'domain' });

  // ── Entity nodes: Agents (managers) — static status, dynamic overlay updates ──
  for (const agent of managers) {
    const assignedTasks = missionTasks.filter(
      (t) => t.assignedManager === agent.id && (t.status === 'running' || t.status === 'ready'),
    );
    const missionMeta = assignedTasks.length > 0
      ? `${assignedTasks.length} task${assignedTasks.length > 1 ? 's' : ''} running`
      : agent.currentActivity;

    nodes.push({
      id: agent.id,
      kind: 'entity',
      label: agent.name,
      ring: 2,
      color: agent.color,
      domainId: 'agents',
      agentId: agent.id,
      status: mapAgentStatus(agent.status, true, false),
      meta: missionMeta,
      capabilities: agent.capabilities,
      missionId: assignedTasks[0]?.missionId,
    });
    edges.push({
      source: 'agents',
      target: agent.id,
      kind: 'entity',
      active: false,
    });
  }

  // ── Entity nodes: Active Missions ──
  for (const mission of activeMissions.slice(0, 4)) {
    const missionStatus: GBrainNodeStatus =
      mission.status === 'executing' ? 'executing' :
      mission.status === 'planning' ? 'thinking' :
      mission.status === 'reviewing' ? 'thinking' :
      mission.status === 'completed' ? 'completed' :
      mission.status === 'failed' ? 'error' : 'idle';

    const taskCount = missionTasks.filter((t) => t.missionId === mission.id).length;

    nodes.push({
      id: `mission-${mission.id}`,
      kind: 'entity',
      label: mission.title.slice(0, 20),
      ring: 2,
      color: missionsColor,
      domainId: 'missions',
      status: missionStatus,
      meta: `${mission.status} · ${mission.progress}% · ${taskCount} tasks`,
      missionId: mission.id,
    });
    edges.push({
      source: 'missions',
      target: `mission-${mission.id}`,
      kind: 'entity',
      active: mission.status === 'executing',
    });
  }

  // ── Entity nodes: Tools (providers) ──
  for (const provider of providers.slice(0, 4)) {
    const toolStatus: GBrainNodeStatus =
      provider.status === 'active' ? 'available' :
      provider.status === 'error' ? 'error' : 'idle';

    nodes.push({
      id: `tool-${provider.id}`,
      kind: 'entity',
      label: provider.name,
      ring: 2,
      color: toolsColor,
      domainId: 'tools',
      status: toolStatus,
      meta: `${provider.status} · ${provider.latency}ms`,
    });
    edges.push({
      source: 'tools',
      target: `tool-${provider.id}`,
      kind: 'entity',
      active: provider.status === 'active',
    });
  }

  // ── Entity nodes: Memory sub-systems ──
  const memorySubsystems = [
    { id: 'mem-episodic', label: 'Episodic', meta: 'Event store' },
    { id: 'mem-semantic', label: 'Semantic', meta: 'Fact store' },
    { id: 'mem-working', label: 'Working', meta: 'Context buffer' },
  ];
  for (const sub of memorySubsystems) {
    nodes.push({
      id: sub.id,
      kind: 'entity',
      label: sub.label,
      ring: 2,
      color: memoryColor,
      domainId: 'memory',
      status: 'available',
      meta: sub.meta,
    });
    edges.push({ source: 'memory', target: sub.id, kind: 'entity' });
  }

  // ── Entity nodes: Knowledge sub-systems ──
  const knowledgeSubsystems = [
    { id: 'kn-facts', label: 'Facts', meta: 'Structured facts' },
    { id: 'kn-entities', label: 'Entities', meta: 'Entity graph' },
    { id: 'kn-relations', label: 'Relations', meta: 'Relationship map' },
  ];
  for (const sub of knowledgeSubsystems) {
    nodes.push({
      id: sub.id,
      kind: 'entity',
      label: sub.label,
      ring: 2,
      color: knowledgeColor,
      domainId: 'knowledge',
      status: 'available',
      meta: sub.meta,
    });
    edges.push({ source: 'knowledge', target: sub.id, kind: 'entity' });
  }

  // ── Leaf nodes: Agent capabilities — static, dynamic overlay updates active flag ──
  for (const agent of managers) {
    const capCount = agent.capabilities.length;
    if (capCount === 0) continue;

    nodes.push({
      id: `${agent.id}-skills`,
      kind: 'leaf',
      label: `${capCount} skills`,
      ring: 3,
      color: agent.color,
      domainId: 'agents',
      agentId: agent.id,
      status: 'idle',
      meta: agent.capabilities.slice(0, 4).join(', '),
      capabilities: agent.capabilities,
    });
    edges.push({
      source: agent.id,
      target: `${agent.id}-skills`,
      kind: 'leaf',
      active: false,
    });
  }

  // ── Leaf nodes: Nova workers — static structure, dynamic overlay updates status ──
  const novaWorkers = getWorkersOf('nova');
  for (const worker of novaWorkers) {
    nodes.push({
      id: worker.id,
      kind: 'leaf',
      label: worker.displayName.replace(' Engineer', ''),
      ring: 3,
      color: worker.themeColor,
      domainId: 'agents',
      agentId: worker.id,
      status: 'available',
      meta: worker.role,
      capabilities: worker.capabilities,
    });
    edges.push({
      source: 'nova',
      target: worker.id,
      kind: 'leaf',
      active: false,
    });
  }

  // ── Cross-links: Manager → Mission tasks (structural, active flag set in overlay) ──
  for (const task of missionTasks.filter((t) => t.status === 'running' || t.status === 'ready')) {
    if (task.assignedManager && task.missionId) {
      const missionNodeId = `mission-${task.missionId}`;
      if (nodes.some((n) => n.id === missionNodeId)) {
        edges.push({
          source: task.assignedManager,
          target: missionNodeId,
          kind: 'entity',
          active: true,
        });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Overlay volatile execution state onto a pre-built static graph.
 * Returns a new graph with updated node statuses and edge active flags.
 * Much cheaper than rebuilding the full structure.
 */
export function applyDynamicState(
  staticGraph: GBrainGraph,
  dynamic: DynamicGraphState,
): GBrainGraph {
  const { executingAgentIds, activeAgentId, activeWorkerId } = dynamic;

  const nodes: GBrainNode[] = staticGraph.nodes.map((n): GBrainNode => {
    // Core node (Temo)
    if (n.id === 'core') {
      const coreStatus: GBrainNodeStatus = executingAgentIds.has('temo')
        ? mapAgentStatus(n.status ?? 'idle', true, true)
        : (n.status ?? 'idle');
      return { ...n, status: coreStatus };
    }

    // Agent entity nodes
    if (n.kind === 'entity' && n.agentId) {
      const isExecuting = executingAgentIds.has(n.agentId);
      const isActive = activeAgentId === n.agentId;
      const baseStatus: GBrainNodeStatus = n.status ?? 'idle';
      const newStatus: GBrainNodeStatus = isExecuting
        ? mapAgentStatus(baseStatus, true, true)
        : isActive
          ? mapAgentStatus(baseStatus, true, false)
          : baseStatus;
      return { ...n, status: newStatus };
    }

    // Agent skills leaf nodes
    if (n.kind === 'leaf' && n.agentId && n.id.endsWith('-skills')) {
      const skillStatus: GBrainNodeStatus = executingAgentIds.has(n.agentId) ? 'working' : 'idle';
      return { ...n, status: skillStatus };
    }

    // Nova worker leaf nodes
    if (n.kind === 'leaf' && n.agentId && !n.id.endsWith('-skills')) {
      const isWorkerExecuting = activeWorkerId === n.agentId || executingAgentIds.has(n.agentId);
      const workerStatus: GBrainNodeStatus = isWorkerExecuting ? 'executing' : 'available';
      return { ...n, status: workerStatus };
    }

    return n;
  });

  const edges = staticGraph.edges.map((e) => {
    // Agent domain → agent entity edges: active if executing or active
    if (e.kind === 'entity' && e.source === 'agents') {
      const isExecuting = executingAgentIds.has(e.target);
      const isActive = activeAgentId === e.target;
      return { ...e, active: isExecuting || isActive };
    }

    // Agent → skills leaf edges: active if agent executing
    if (e.kind === 'leaf' && e.source !== 'nova' && e.target.endsWith('-skills')) {
      return { ...e, active: executingAgentIds.has(e.source) };
    }

    // Nova → worker edges: active if worker executing
    if (e.kind === 'leaf' && e.source === 'nova') {
      const isWorkerExecuting = activeWorkerId === e.target || executingAgentIds.has(e.target);
      return { ...e, active: isWorkerExecuting };
    }

    return e;
  });

  // Add dynamic cross-link: Temo → active manager (execution path)
  if (activeAgentId && activeAgentId !== 'temo') {
    const hasActiveLink = edges.some(
      (e) => e.source === 'core' && e.target === activeAgentId && e.kind === 'entity',
    );
    if (!hasActiveLink) {
      const activeManagerExists = nodes.some(
        (n) => n.id === activeAgentId && n.kind === 'entity',
      );
      if (activeManagerExists) {
        edges.push({
          source: 'core',
          target: activeAgentId,
          kind: 'entity',
          active: true,
        });
      }
    }
  }

  return { nodes, edges };
}

// ---- Helper: convert activity feed items to G-Brain activity format ----
export function normalizeActivity(
  feed: ActivityFeedItem[],
): { id: string; label: string; detail: string; time: string; type: string }[] {
  return feed.slice(0, 8).map((item) => ({
    id: item.id,
    label: item.title,
    detail: item.detail,
    time: '',
    type: mapActivityType(item.type),
  }));
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
}

function mapActivityType(type: string): string {
  if (type === 'routing') return 'system';
  if (type === 'task') return 'workflow';
  if (type === 'voice') return 'voice';
  if (type === 'error') return 'system';
  if (type === 'notification') return 'system';
  return type;
}

// ---- Helper: normalize missions for display ──
export function normalizeMissions(
  missions: Mission[],
  tasks: MissionTask[],
): {
  id: string;
  name: string;
  status: string;
  progress: number;
  steps: number;
  lastRun: string;
}[] {
  const active = missions
    .filter((m) => m.status !== 'completed' && m.status !== 'cancelled' && m.status !== 'failed')
    .slice(0, 4);

  if (active.length === 0) {
    // Show recently completed if no active
    return missions
      .filter((m) => m.status === 'completed' || m.status === 'failed')
      .slice(0, 2)
      .map((m) => ({
        id: m.id,
        name: m.title,
        status: m.status === 'completed' ? 'idle' : 'error',
        progress: m.progress,
        steps: tasks.filter((t) => t.missionId === m.id).length,
        lastRun: timeAgo(new Date(m.updatedAt).getTime()),
      }));
  }

  return active.map((m) => {
    const missionTasks = tasks.filter((t) => t.missionId === m.id);
    return {
      id: m.id,
      name: m.title,
      status:
        m.status === 'executing' ? 'running' :
        m.status === 'planning' ? 'paused' :
        m.status === 'paused' ? 'paused' :
        m.status === 'failed' ? 'error' : 'idle',
      progress: m.progress,
      steps: missionTasks.length || m.estimatedTasks,
      lastRun: m.status === 'executing' ? 'Running now' : '',
    };
  });
}

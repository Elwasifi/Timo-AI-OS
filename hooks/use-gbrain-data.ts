'use client';

import { useMemo, useEffect, useState } from 'react';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useRuntimeEvents } from '@/hooks/use-runtime-events';
import { buildStaticGraph, applyDynamicState, normalizeMissions, normalizeActivity } from '@/lib/gbrain/graph-builder';
import { listMissions, getTasks } from '@/lib/swarm/missionService';
import type { Mission, MissionTask } from '@/lib/swarm/types';
import type { GBrainGraph } from '@/lib/gbrain/layout';

export interface GBrainData {
  graph: GBrainGraph;
  missions: { id: string; name: string; status: string; progress: number; steps: number; lastRun: string }[];
  activity: { id: string; label: string; detail: string; time: string; type: string }[];
  executingAgentIds: Set<string>;
  activeAgentId: string;
  hasActiveMission: boolean;
}

export function useGBrainData(): GBrainData {
  const agents = useDashboardStore((s) => s.agents);
  const providers = useDashboardStore((s) => s.providers);
  const orchestrationActivity = useOrchestrationStore((s) => s.activityFeed);
  const activeAgentId = useOrchestrationStore((s) => s.activeAgentId);
  const activeWorkerId = useOrchestrationStore((s) => s.activeWorkerId);
  const isRouting = useOrchestrationStore((s) => s.isRouting);
  const taskQueue = useOrchestrationStore((s) => s.taskQueue);
  const isThinking = useVoiceStore((s) => s.isThinking);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);

  // Runtime events are the source of truth — SSE stream drives
  // activeAgentId, activeWorkerId, agent statuses, and orb state.
  useRuntimeEvents();

  // Fetch real missions from database
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionTasks, setMissionTasks] = useState<MissionTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    async function fetchMissions() {
      try {
        const active = await listMissions(20);
        if (cancelled) return;
        setMissions(active);

        // Fetch tasks for active missions
        const activeIds = active
          .filter((m) => m.status === 'executing' || m.status === 'planning' || m.status === 'ready' || m.status === 'reviewing')
          .map((m) => m.id);

        if (activeIds.length > 0) {
          const tasks: MissionTask[] = [];
          for (const id of activeIds) {
            const t = await getTasks(id);
            tasks.push(...t);
          }
          if (!cancelled) setMissionTasks(tasks);
        } else {
          if (!cancelled) setMissionTasks([]);
        }
      } catch {
        // Silently fail — graph still works with store data
      }
    }

    fetchMissions();
    // Poll every 15 seconds for mission updates
    pollTimer = setInterval(fetchMissions, 15000);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, []);

  // Build executing agent IDs from multiple sources
  const executingAgentIds = useMemo(() => {
    const ids = new Set<string>();
    // From task queue — agents currently processing
    taskQueue.forEach((t) => {
      if (t.status === 'thinking' || t.status === 'dispatched' || t.status === 'analyzing' || t.status === 'responding') {
        ids.add(t.agentId);
      }
    });
    // From mission tasks
    missionTasks.forEach((t) => {
      if (t.status === 'running' && t.assignedManager) {
        ids.add(t.assignedManager);
      }
    });
    // From voice state — Temo is thinking/speaking
    if (isThinking || isSpeaking) {
      ids.add('temo');
    }
    // From routing
    if (isRouting) {
      ids.add(activeAgentId);
    }
    return ids;
  }, [taskQueue, missionTasks, isThinking, isSpeaking, isRouting, activeAgentId]);

  // Static graph structure: rebuilds only when agents, missions, or providers change.
  // NOT rebuilt on every thinking/speaking/routing transition.
  const staticGraph = useMemo(
    () =>
      buildStaticGraph({
        runtimeAgents: agents,
        missions,
        missionTasks,
        providers,
      }),
    [agents, missions, missionTasks, providers],
  );

  // Dynamic overlay: applies execution statuses and active edges on top of the
  // pre-built static structure. Cheap — just maps over existing nodes/edges.
  const graph = useMemo(
    () =>
      applyDynamicState(staticGraph, {
        executingAgentIds,
        activeAgentId,
        activeWorkerId,
      }),
    [staticGraph, executingAgentIds, activeAgentId, activeWorkerId],
  );

  // Normalize missions for display
  const displayMissions = useMemo(
    () => normalizeMissions(missions, missionTasks),
    [missions, missionTasks],
  );

  // Use real orchestration activity, fall back to dashboard mock if empty
  const dashboardActivity = useDashboardStore((s) => s.activity);
  const activity = useMemo(() => {
    if (orchestrationActivity.length > 1) {
      return normalizeActivity(orchestrationActivity);
    }
    // Fall back to dashboard mock data (only when no real activity yet)
    return dashboardActivity.slice(0, 6).map((a) => ({
      id: a.id,
      label: a.label,
      detail: a.detail,
      time: a.time,
      type: a.type,
    }));
  }, [orchestrationActivity, dashboardActivity]);

  const hasActiveMission = useMemo(
    () => missions.some((m) => m.status === 'executing' || m.status === 'planning' || m.status === 'ready' || m.status === 'reviewing'),
    [missions],
  );

  return {
    graph,
    missions: displayMissions,
    activity,
    executingAgentIds,
    activeAgentId,
    hasActiveMission,
  };
}

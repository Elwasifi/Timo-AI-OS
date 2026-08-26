'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { supabase } from '@/lib/supabase/client';
import type { AgentStatus } from '@/types';

export type RuntimeEventType =
  | 'thinking'
  | 'routing'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'synthesizing'
  | 'speaking'
  | 'completed'
  | 'failed';

export interface RuntimeStreamEvent {
  eventType: RuntimeEventType;
  agentId: string | null;
  workerId: string | null;
  missionId: string | null;
  taskId: string | null;
  status: string | null;
  title: string;
  detail: string;
  timestamp: string;
}

const TERMINAL_EVENTS: RuntimeEventType[] = ['completed', 'failed'];

const STATUS_MAP: Record<RuntimeEventType, AgentStatus> = {
  thinking: 'thinking',
  routing: 'thinking',
  planning: 'thinking',
  executing: 'busy',
  reviewing: 'thinking',
  synthesizing: 'thinking',
  speaking: 'speaking',
  completed: 'available',
  failed: 'available',
};

const ACTIVITY_MAP: Record<RuntimeEventType, string> = {
  thinking: 'Thinking…',
  routing: 'Routing request…',
  planning: 'Planning mission…',
  executing: 'Executing task…',
  reviewing: 'Reviewing results…',
  synthesizing: 'Synthesizing response…',
  speaking: 'Speaking…',
  completed: 'Completed',
  failed: 'Failed',
};

/**
 * Connects to /api/stream/runtime SSE and reflects real runtime activity
 * into the orchestration and voice stores. Runtime events are the source
 * of truth for active agent/worker state.
 */
export function useRuntimeEvents(): void {
  const setRoutingInProgress = useOrchestrationStore((s) => s.setRoutingInProgress);
  const setActiveAgent = useOrchestrationStore((s) => s.setActiveAgent);
  const setActiveWorker = useOrchestrationStore((s) => s.setActiveWorker);
  const clearActiveExecution = useOrchestrationStore((s) => s.clearActiveExecution);
  const addActivity = useOrchestrationStore((s) => s.addActivity);
  const updateAgentStatus = useOrchestrationStore((s) => s.updateAgentStatus);
  const setOrbState = useVoiceStore((s) => s.setOrbState);
  const lastEventTs = useRef<string>('');

  const handleEvent = useCallback(
    (raw: RuntimeStreamEvent) => {
      if (raw.timestamp && raw.timestamp === lastEventTs.current) return;
      lastEventTs.current = raw.timestamp;

      const { eventType, agentId, workerId } = raw;
      if (!agentId) return;

      const isTerminal = TERMINAL_EVENTS.includes(eventType);

      addActivity({
        type:
          eventType === 'routing'
            ? 'routing'
            : eventType === 'speaking'
              ? 'voice'
              : eventType === 'failed'
                ? 'error'
                : 'task',
        title: raw.title || ACTIVITY_MAP[eventType],
        detail: raw.detail,
        agentId,
      });

      if (isTerminal) {
        clearActiveExecution();
        setOrbState('idle');
        return;
      }

      if (agentId !== 'temo') {
        setActiveAgent(agentId);
      }

      if (workerId) {
        setActiveWorker(workerId);
        updateAgentStatus(workerId, STATUS_MAP[eventType], ACTIVITY_MAP[eventType]);
      }

      updateAgentStatus(agentId, STATUS_MAP[eventType], ACTIVITY_MAP[eventType]);

      if (agentId === 'temo') {
        if (eventType === 'thinking' || eventType === 'planning' || eventType === 'routing') {
          setOrbState('thinking');
        } else if (eventType === 'speaking') {
          setOrbState('speaking');
        } else if (eventType === 'executing') {
          setOrbState('thinking');
        }
      }

      setRoutingInProgress(eventType === 'routing');
    },
    [
      addActivity,
      clearActiveExecution,
      setActiveAgent,
      setActiveWorker,
      setOrbState,
      setRoutingInProgress,
      updateAgentStatus,
    ],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;
      // EventSource can't set an Authorization header — the token is passed
      // as a query param instead (requireUser() accepts either; see
      // lib/auth/apiAuth.ts). Without a session, don't bother connecting —
      // the route will just 401.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || stopped) return;
      const es = new EventSource(`/api/stream/runtime?token=${encodeURIComponent(token)}`);
      es.addEventListener('decision_made', (msg: MessageEvent) => {
        try {
          handleEvent(JSON.parse(msg.data) as RuntimeStreamEvent);
        } catch {
          /* ignore malformed payload */
        }
      });
      es.addEventListener('mission_progress', () => {
        /* state-change notification only — decision_made events carry the chain */
      });
      es.onerror = () => {
        es.close();
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
    };
  }, [handleEvent]);
}

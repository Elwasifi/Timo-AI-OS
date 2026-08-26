// Phase 5 — Realtime Gateway
//
// Lightweight realtime layer using Supabase Realtime subscriptions.
// The UI subscribes to Postgres Changes on runtime tables to receive
// live updates without polling.
//
// This module provides:
//   1. Server-side helper to generate subscription channel names
//   2. Client-side hook (useRealtime) for React components
//   3. SSE endpoint for streaming mission execution events
//
// No custom websocket framework — reuses Supabase Realtime.

import { supabase } from '@/lib/supabase/client';

// ---- Channel Names ----

export const REALTIME_CHANNELS = {
  runtimeState: 'runtime_state_changes',
  runtimeActivity: 'runtime_activity_changes',
  missionTimeline: 'mission_timeline_changes',
  missionTasks: 'mission_tasks_changes',
  missions: 'missions_changes',
} as const;

// ---- Server-side: Broadcast an event to the realtime channel ----
//
// Supabase Realtime broadcasts Postgres Changes automatically when
// rows are inserted/updated/deleted on tables with RLS enabled.
// This helper sends a custom broadcast event for ad-hoc notifications
// (e.g., "mission_started") that aren't tied to a row change.

export async function broadcastEvent(
  channel: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ch = supabase.channel(channel);
  await ch.subscribe();
  await ch.send({ type: 'broadcast', event, payload });
  supabase.removeChannel(ch);
}

// ---- Client-side hook ----
//
// Returns a typed subscription helper that the v0 UI can use.
// This is a thin wrapper — the actual React hook lives in the UI layer.

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

export function subscribeToTable(
  table: string,
  callback: (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void,
): RealtimeSubscription {
  const channel = supabase
    .channel(`realtime:${table}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        callback({
          eventType: payload.eventType,
          new: (payload.new as Record<string, unknown>) ?? {},
          old: (payload.old as Record<string, unknown>) ?? {},
        });
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

// ---- SSE Event Types (for streaming endpoint) ----

export type StreamEvent =
  | 'mission_started'
  | 'manager_assigned'
  | 'task_started'
  | 'task_finished'
  | 'tool_executed'
  | 'workflow_executed'
  | 'memory_loaded'
  | 'knowledge_retrieved'
  | 'provider_selected'
  | 'mission_progress'
  | 'mission_completed'
  | 'mission_failed'
  | 'decision_made'
  | 'response_delivered';

export interface StreamPayload {
  event: StreamEvent;
  missionId?: string;
  taskId?: string;
  agentId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function formatSSE(event: StreamEvent, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

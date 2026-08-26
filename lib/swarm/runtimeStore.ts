// Phase 4 — Runtime Store
//
// Persistent runtime state for Temo AI OS. Replaces in-memory-only
// orchestration state with database-backed state that survives
// page reloads and session restarts.
//
// State stored:
//   - Current Mission ID
//   - Mission Progress
//   - Current Manager ID
//   - Running Task IDs
//   - Execution State (idle, routing, executing, completed, failed)
//   - Timeline Summary (recent timeline events)
//   - Metadata (extensible)
//
// Also provides an append-only activity feed via runtime_activity.

import { supabase } from '@/lib/supabase/client';
import type { TimelineEntry } from './types';

// ---- Types ----

export type ExecutionState = 'idle' | 'routing' | 'executing' | 'completed' | 'failed';

/**
 * Phase 3A — Standardized Runtime Event
 *
 * The single truthful execution event structure emitted by the runtime.
 * Every execution point (orchestrator, execution layer, Nova delegation)
 * emits events using this shape so the Chat/G-Brain can consume one
 * consistent stream.
 *
 * The required fields form the execution chain:
 *   agentId   — who is currently acting (temo, nova, nova-frontend, etc.)
 *   workerId  — nullable; set only when a worker is acting under a manager
 *   missionId — nullable; set when this event belongs to a mission pipeline
 *   taskId    — nullable; set when this event belongs to a specific task
 */
export type RuntimeEventStatus = 'active' | 'completed' | 'failed';

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

export interface RuntimeEvent {
  eventType: RuntimeEventType;
  agentId: string;
  workerId: string | null;
  missionId: string | null;
  taskId: string | null;
  timestamp: string;
  status: RuntimeEventStatus;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeState {
  currentMissionId: string | null;
  currentManagerId: string;
  executionState: ExecutionState;
  runningTaskIds: string[];
  missionProgress: number;
  timelineSummary: TimelineEntry[];
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface RuntimeActivityItem {
  id: string;
  eventType: string;
  title: string;
  detail: string;
  agentId: string | null;
  workerId: string | null;
  missionId: string | null;
  taskId: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---- Runtime State CRUD ----

export async function getRuntimeState(): Promise<RuntimeState> {
  const { data, error } = await supabase
    .from('runtime_state')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

  if (error || !data) {
    return {
      currentMissionId: null,
      currentManagerId: 'temo',
      executionState: 'idle',
      runningTaskIds: [],
      missionProgress: 0,
      timelineSummary: [],
      metadata: {},
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    currentMissionId: data.current_mission_id,
    currentManagerId: data.current_manager_id ?? 'temo',
    executionState: (data.execution_state as ExecutionState) ?? 'idle',
    runningTaskIds: data.running_task_ids ?? [],
    missionProgress: data.mission_progress ?? 0,
    timelineSummary: Array.isArray(data.timeline_summary) ? data.timeline_summary : [],
    metadata: data.metadata ?? {},
    updatedAt: data.updated_at,
  };
}

export async function updateRuntimeState(
  patch: Partial<Omit<RuntimeState, 'updatedAt'>>,
): Promise<RuntimeState | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.currentMissionId !== undefined) update.current_mission_id = patch.currentMissionId;
  if (patch.currentManagerId !== undefined) update.current_manager_id = patch.currentManagerId;
  if (patch.executionState !== undefined) update.execution_state = patch.executionState;
  if (patch.runningTaskIds !== undefined) update.running_task_ids = patch.runningTaskIds;
  if (patch.missionProgress !== undefined) update.mission_progress = patch.missionProgress;
  if (patch.timelineSummary !== undefined) update.timeline_summary = patch.timelineSummary;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;

  const { data, error } = await supabase
    .from('runtime_state')
    .update(update)
    .eq('id', 'default')
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return {
    currentMissionId: data.current_mission_id,
    currentManagerId: data.current_manager_id ?? 'temo',
    executionState: (data.execution_state as ExecutionState) ?? 'idle',
    runningTaskIds: data.running_task_ids ?? [],
    missionProgress: data.mission_progress ?? 0,
    timelineSummary: Array.isArray(data.timeline_summary) ? data.timeline_summary : [],
    metadata: data.metadata ?? {},
    updatedAt: data.updated_at,
  };
}

// ---- Activity Feed ----

export interface AddRuntimeActivityInput {
  eventType: string;
  title: string;
  detail?: string;
  agentId?: string;
  workerId?: string | null;
  missionId?: string | null;
  taskId?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
}

export async function addRuntimeActivity(input: AddRuntimeActivityInput): Promise<void> {
  await supabase.from('runtime_activity').insert({
    event_type: input.eventType,
    title: input.title,
    detail: input.detail ?? '',
    agent_id: input.agentId ?? null,
    worker_id: input.workerId ?? null,
    mission_id: input.missionId ?? null,
    task_id: input.taskId ?? null,
    status: input.status ?? null,
    metadata: input.metadata ?? {},
  });
}

/**
 * Phase 3A — Emit a standardized runtime event to the activity feed.
 *
 * This is the single entry point for all runtime execution events.
 * Every execution point calls this so the event structure is consistent
 * and the execution chain (agent → worker → mission → task) is preserved.
 */
export async function emitRuntimeEvent(event: RuntimeEvent): Promise<void> {
  await addRuntimeActivity({
    eventType: event.eventType,
    title: event.title,
    detail: event.detail,
    agentId: event.agentId,
    workerId: event.workerId,
    missionId: event.missionId,
    taskId: event.taskId,
    status: event.status,
    metadata: { ...event.metadata, timestamp: event.timestamp },
  });
}

export async function getRuntimeActivity(limit = 30): Promise<RuntimeActivityItem[]> {
  const { data, error } = await supabase
    .from('runtime_activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as Array<{
    id: string;
    event_type: string;
    title: string;
    detail: string;
    agent_id: string | null;
    worker_id: string | null;
    mission_id: string | null;
    task_id: string | null;
    status: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    eventType: r.event_type,
    title: r.title,
    detail: r.detail,
    agentId: r.agent_id,
    workerId: r.worker_id,
    missionId: r.mission_id,
    taskId: r.task_id,
    status: r.status,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  }));
}

// ---- Tenant-scoped views (M2-01) ----
//
// runtime_state is a literal global singleton (one row, id='default') and
// runtime_activity has no tenant_id column at all — both predate the V1
// multi-tenant work. A full per-tenant redesign of the execution engine's
// state model is out of scope here (M2 is meant to be short and focused on
// beta-readiness, not an architecture rewrite). Instead: mission-linked
// content (titles, progress, activity tied to a specific mission) is
// redacted for a caller who doesn't own that mission, via a lookup against
// `missions` (which IS tenant-scoped) — a real, live-testable fix that
// doesn't require a schema migration. Events/state with no missionId at
// all (generic system heartbeats) remain visible to every tenant, since
// they carry no tenant-specific content to begin with.

async function missionBelongsToTenant(missionId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase.from('missions').select('id').eq('id', missionId).eq('tenant_id', tenantId).maybeSingle();
  return !!data;
}

/** getRuntimeState(), but mission-specific fields are redacted if the current mission isn't the caller's. */
export async function getRuntimeStateForTenant(tenantId: string): Promise<RuntimeState> {
  const state = await getRuntimeState();
  if (!state.currentMissionId) return state;
  const owned = await missionBelongsToTenant(state.currentMissionId, tenantId);
  if (owned) return state;
  return {
    ...state,
    currentMissionId: null,
    missionProgress: 0,
    timelineSummary: [],
  };
}

/** getRuntimeActivity(), with any row tied to a mission the caller doesn't own filtered out. */
export async function getRuntimeActivityForTenant(tenantId: string, limit = 30): Promise<RuntimeActivityItem[]> {
  // Over-fetch before filtering so redacting foreign-tenant rows doesn't
  // silently under-fill the caller's own feed.
  const items = await getRuntimeActivity(Math.max(limit * 3, 90));
  const missionIds = Array.from(new Set(items.map((i) => i.missionId).filter((id): id is string => !!id)));
  if (missionIds.length === 0) return items.slice(0, limit);

  const { data: ownedMissions } = await supabase.from('missions').select('id').eq('tenant_id', tenantId).in('id', missionIds);
  const ownedIds = new Set((ownedMissions ?? []).map((m) => m.id as string));

  return items.filter((i) => !i.missionId || ownedIds.has(i.missionId)).slice(0, limit);
}

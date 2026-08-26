// Phase 2 — Mission Service (Database CRUD)
//
// Reads and writes missions, objectives, tasks, and timeline entries
// to the Supabase database. This is the persistence layer for the
// mission engine — no business logic lives here.

import { supabase } from '@/lib/supabase/client';
import type {
  Mission,
  MissionObjective,
  MissionTask,
  TimelineEntry,
  MissionStatus,
  MissionPriority,
  MissionComplexity,
  ObjectiveStatus,
  TaskQueueStatus,
  ExecutionLogEntry,
  TimelineEventType,
} from './types';

// ---- Row Types (snake_case from DB) ----

interface MissionRow {
  id: string;
  title: string;
  objective: string;
  user_request: string;
  priority: string;
  status: string;
  progress: number;
  estimated_complexity: string;
  estimated_tasks: number;
  parent_mission_id: string | null;
  metadata: Record<string, unknown>;
  tenant_id: string;
  is_simulation: boolean;
  created_at: string;
  updated_at: string;
}

interface ObjectiveRow {
  id: string;
  mission_id: string;
  title: string;
  required_capability: string;
  estimated_effort: string;
  dependencies: unknown;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  mission_id: string;
  objective_id: string | null;
  parent_task_id: string | null;
  assigned_manager: string | null;
  assigned_worker: string | null;
  required_capability: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  dependencies: unknown;
  retries: number;
  max_retries: number;
  execution_log: unknown;
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TimelineRow {
  id: string;
  mission_id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---- Mappers ----

function mapMission(row: MissionRow): Mission {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    userRequest: row.user_request,
    priority: row.priority as MissionPriority,
    status: row.status as MissionStatus,
    progress: row.progress,
    estimatedComplexity: row.estimated_complexity as MissionComplexity,
    estimatedTasks: row.estimated_tasks,
    parentMissionId: row.parent_mission_id,
    metadata: row.metadata ?? {},
    tenantId: row.tenant_id,
    isSimulation: row.is_simulation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapObjective(row: ObjectiveRow): MissionObjective {
  return {
    id: row.id,
    missionId: row.mission_id,
    title: row.title,
    requiredCapability: row.required_capability,
    estimatedEffort: row.estimated_effort as 'low' | 'medium' | 'high',
    dependencies: Array.isArray(row.dependencies)
      ? (row.dependencies as string[])
      : [],
    status: row.status as ObjectiveStatus,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): MissionTask {
  return {
    id: row.id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    parentTaskId: row.parent_task_id,
    assignedManager: row.assigned_manager,
    assignedWorker: row.assigned_worker,
    requiredCapability: row.required_capability,
    title: row.title,
    description: row.description,
    priority: row.priority as MissionPriority,
    status: row.status as TaskQueueStatus,
    dependencies: Array.isArray(row.dependencies)
      ? (row.dependencies as string[])
      : [],
    retries: row.retries,
    maxRetries: row.max_retries,
    executionLog: Array.isArray(row.execution_log)
      ? (row.execution_log as ExecutionLogEntry[])
      : [],
    result: row.result,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapTimeline(row: TimelineRow): TimelineEntry {
  return {
    id: row.id,
    missionId: row.mission_id,
    eventType: row.event_type as TimelineEventType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    detail: row.detail,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// ---- Mission CRUD ----

export async function createMission(input: {
  title: string;
  objective: string;
  userRequest: string;
  priority?: MissionPriority;
  estimatedComplexity?: MissionComplexity;
  estimatedTasks?: number;
  parentMissionId?: string | null;
  metadata?: Record<string, unknown>;
  /** Required — every mission belongs to a tenant (internal or client). */
  tenantId: string;
  isSimulation?: boolean;
}): Promise<Mission | null> {
  const { data, error } = await supabase
    .from('missions')
    .insert({
      title: input.title,
      objective: input.objective,
      user_request: input.userRequest,
      priority: input.priority ?? 'medium',
      status: 'pending',
      progress: 0,
      estimated_complexity: input.estimatedComplexity ?? 'simple',
      estimated_tasks: input.estimatedTasks ?? 1,
      parent_mission_id: input.parentMissionId ?? null,
      metadata: input.metadata ?? {},
      tenant_id: input.tenantId,
      is_simulation: input.isSimulation ?? false,
    })
    .select()
    .single();

  if (error) {
    console.error('[swarm] Failed to create mission:', error.message);
    return null;
  }

  return mapMission(data as MissionRow);
}

export async function getMission(id: string): Promise<Mission | null> {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return mapMission(data as MissionRow);
}

export async function updateMission(
  id: string,
  patch: Partial<Pick<Mission, 'status' | 'progress' | 'priority' | 'metadata' | 'title'>>,
): Promise<Mission | null> {
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.progress !== undefined) update.progress = patch.progress;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;
  if (patch.title !== undefined) update.title = patch.title;

  const { data, error } = await supabase
    .from('missions')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return mapMission(data as MissionRow);
}

export async function listMissions(
  limit = 50,
  status?: MissionStatus,
  tenantId?: string,
): Promise<Mission[]> {
  let query = supabase
    .from('missions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('status', status);
  }
  // RLS already enforces tenant isolation — this filter is defense in
  // depth / lets callers scope a query to one tenant when a user belongs
  // to multiple (staff case).
  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as MissionRow[]).map(mapMission);
}

// ---- Objective CRUD ----

export async function createObjectives(
  missionId: string,
  objectives: Array<{
    title: string;
    requiredCapability: string;
    estimatedEffort: string;
    dependencies: string[];
    sortOrder: number;
  }>,
): Promise<MissionObjective[]> {
  const rows = objectives.map((o) => ({
    mission_id: missionId,
    title: o.title,
    required_capability: o.requiredCapability,
    estimated_effort: o.estimatedEffort,
    dependencies: o.dependencies,
    status: 'pending' as const,
    sort_order: o.sortOrder,
  }));

  const { data, error } = await supabase
    .from('mission_objectives')
    .insert(rows)
    .select();

  if (error || !data) {
    console.error('[swarm] Failed to create objectives:', error?.message);
    return [];
  }

  return (data as ObjectiveRow[]).map(mapObjective);
}

export async function getObjectives(missionId: string): Promise<MissionObjective[]> {
  const { data, error } = await supabase
    .from('mission_objectives')
    .select('*')
    .eq('mission_id', missionId)
    .order('sort_order', { ascending: true });

  if (error || !data) return [];
  return (data as ObjectiveRow[]).map(mapObjective);
}

export async function updateObjective(
  id: string,
  patch: { status?: ObjectiveStatus },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;

  await supabase.from('mission_objectives').update(update).eq('id', id);
}

// ---- Task CRUD ----

export async function createTasks(
  missionId: string,
  tasks: Array<{
    objectiveId?: string | null;
    requiredCapability: string;
    title: string;
    description: string;
    priority?: MissionPriority;
    dependencies?: string[];
  }>,
): Promise<MissionTask[]> {
  const rows = tasks.map((t) => ({
    mission_id: missionId,
    objective_id: t.objectiveId ?? null,
    required_capability: t.requiredCapability,
    title: t.title,
    description: t.description,
    priority: t.priority ?? 'medium',
    status: 'waiting' as const,
    dependencies: t.dependencies ?? [],
  }));

  const { data, error } = await supabase
    .from('mission_tasks')
    .insert(rows)
    .select();

  if (error || !data) {
    console.error('[swarm] Failed to create tasks:', error?.message);
    return [];
  }

  return (data as TaskRow[]).map(mapTask);
}

export async function getTasks(missionId: string): Promise<MissionTask[]> {
  const { data, error } = await supabase
    .from('mission_tasks')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as TaskRow[]).map(mapTask);
}

/** Recent tasks assigned to a given manager — used by the G-Brain agent
 * detail view to show "what has this agent been working on" without
 * requiring a dedicated per-agent activity table. */
export async function getRecentTasksByManager(
  managerId: string,
  limit = 5,
): Promise<MissionTask[]> {
  const { data, error } = await supabase
    .from('mission_tasks')
    .select('*')
    .eq('assigned_manager', managerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as TaskRow[]).map(mapTask);
}

export async function getReadyTasks(): Promise<MissionTask[]> {
  const { data, error } = await supabase
    .from('mission_tasks')
    .select('*')
    .eq('status', 'ready')
    .order('priority', { ascending: false })
    .limit(20);

  if (error || !data) return [];
  return (data as TaskRow[]).map(mapTask);
}

export async function updateTask(
  id: string,
  patch: {
    status?: TaskQueueStatus;
    assignedManager?: string | null;
    assignedWorker?: string | null;
    result?: Record<string, unknown> | null;
    errorMessage?: string | null;
    retries?: number;
    executionLog?: ExecutionLogEntry[];
    startedAt?: string;
    completedAt?: string;
  },
): Promise<MissionTask | null> {
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.assignedManager !== undefined) update.assigned_manager = patch.assignedManager;
  if (patch.assignedWorker !== undefined) update.assigned_worker = patch.assignedWorker;
  if (patch.result !== undefined) update.result = patch.result;
  if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage;
  if (patch.retries !== undefined) update.retries = patch.retries;
  if (patch.executionLog !== undefined) update.execution_log = patch.executionLog;
  if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;

  const { data, error } = await supabase
    .from('mission_tasks')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return mapTask(data as TaskRow);
}

/**
 * Atomically transition a task from 'ready' (or 'waiting', for the direct
 * synchronous-dispatch path which doesn't always pass through 'ready'
 * first) to 'running'. Returns the claimed task, or `null` if it was
 * already claimed/moved by someone else (its status was neither of those
 * two rows when this ran) — the caller MUST treat `null` as "do not
 * execute this task", not as an error.
 *
 * This exists because two independent call sites can reach `executeTask`
 * for the same task: the synchronous in-request mission pipeline, and the
 * background queue processor (`/api/tasks/process`, via `claim_ready_tasks`).
 * Neither previously checked whether the other had already started the
 * task, so a race between them could execute the same task twice. A plain
 * `UPDATE ... WHERE id = $id AND status IN (...)` is atomic at the
 * database level — only one caller's UPDATE can match the row.
 */
export async function claimTask(id: string, assignedWorker?: string | null): Promise<MissionTask | null> {
  const update: Record<string, unknown> = { status: 'running', started_at: new Date().toISOString() };
  if (assignedWorker !== undefined) update.assigned_worker = assignedWorker;

  const { data, error } = await supabase
    .from('mission_tasks')
    .update(update)
    .eq('id', id)
    .in('status', ['ready', 'waiting'])
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return mapTask(data as TaskRow);
}

export async function appendExecutionLog(
  id: string,
  entry: ExecutionLogEntry,
): Promise<void> {
  const { data } = await supabase
    .from('mission_tasks')
    .select('execution_log')
    .eq('id', id)
    .maybeSingle();

  const log = Array.isArray(data?.execution_log)
    ? (data!.execution_log as ExecutionLogEntry[])
    : [];

  await supabase
    .from('mission_tasks')
    .update({ execution_log: [...log, entry] })
    .eq('id', id);
}

// ---- Organizational Learning (Section 3E) ----
//
// Deliberately narrow: called only from recalculateProgress() at genuine
// mission-level outcome signals (full failure, or partial failure inside an
// otherwise-completed mission) — never per-task, per-retry, or on ordinary
// success, so this table stays a real signal instead of being flooded with
// "mission 123 completed" noise on every run.
export async function recordLesson(input: {
  tenantId: string | null;
  missionId: string;
  category?: string;
  summary: string;
  detail?: string;
  outcome: 'success' | 'failure' | 'partial';
}): Promise<void> {
  await supabase.from('lessons_learned').insert({
    tenant_id: input.tenantId,
    mission_id: input.missionId,
    category: input.category ?? 'general',
    summary: input.summary,
    detail: input.detail ?? '',
    outcome: input.outcome,
  });
}

// ---- Timeline CRUD ----

export async function addTimelineEntry(input: {
  missionId: string;
  eventType: TimelineEventType;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}): Promise<TimelineEntry | null> {
  const { data, error } = await supabase
    .from('mission_timeline')
    .insert({
      mission_id: input.missionId,
      event_type: input.eventType,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      title: input.title,
      detail: input.detail ?? '',
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    console.error('[swarm] Failed to add timeline entry:', error.message);
    return null;
  }

  return mapTimeline(data as TimelineRow);
}

export async function getTimeline(missionId: string): Promise<TimelineEntry[]> {
  const { data, error } = await supabase
    .from('mission_timeline')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as TimelineRow[]).map(mapTimeline);
}

// ---- Batch Reads ----

export async function getFullMission(missionId: string): Promise<{
  mission: Mission | null;
  objectives: MissionObjective[];
  tasks: MissionTask[];
  timeline: TimelineEntry[];
}> {
  const [mission, objectives, tasks, timeline] = await Promise.all([
    getMission(missionId),
    getObjectives(missionId),
    getTasks(missionId),
    getTimeline(missionId),
  ]);

  return { mission, objectives, tasks, timeline };
}

// Phase 2 — Mission Timeline Tracker
//
// Records lifecycle events to the mission_timeline table. Each event
// captures a stage in the mission lifecycle. The timeline is append-only
// and becomes the data source for the future cinematic dashboard.
//
// Events flow:
//   mission_created → mission_planned → objectives_generated → tasks_created
//   → task_assigned → task_started → task_completed → mission_completed

import { addTimelineEntry } from './missionService';
import type { TimelineEventType } from './types';

export async function recordEvent(
  missionId: string,
  eventType: TimelineEventType,
  options: {
    entityType?: string | null;
    entityId?: string | null;
    title: string;
    detail?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await addTimelineEntry({
    missionId,
    eventType,
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
    title: options.title,
    detail: options.detail ?? '',
    metadata: options.metadata ?? {},
  });
}

export async function recordMissionCreated(
  missionId: string,
  title: string,
  userRequest: string,
): Promise<void> {
  await recordEvent(missionId, 'mission_created', {
    entityType: 'mission',
    entityId: missionId,
    title: `Mission created: ${title}`,
    detail: userRequest.slice(0, 200),
  });
}

export async function recordMissionPlanned(
  missionId: string,
  complexity: string,
  estimatedTasks: number,
): Promise<void> {
  await recordEvent(missionId, 'mission_planned', {
    entityType: 'mission',
    entityId: missionId,
    title: `Mission planned — ${complexity} complexity, ~${estimatedTasks} tasks`,
    detail: `Complexity: ${complexity}, Estimated tasks: ${estimatedTasks}`,
    metadata: { complexity, estimatedTasks },
  });
}

export async function recordObjectivesGenerated(
  missionId: string,
  count: number,
): Promise<void> {
  await recordEvent(missionId, 'objectives_generated', {
    entityType: 'mission',
    entityId: missionId,
    title: `${count} objective${count !== 1 ? 's' : ''} generated`,
    detail: `Decomposed mission into ${count} objective${count !== 1 ? 's' : ''}`,
    metadata: { count },
  });
}

export async function recordTasksCreated(
  missionId: string,
  count: number,
): Promise<void> {
  await recordEvent(missionId, 'tasks_created', {
    entityType: 'mission',
    entityId: missionId,
    title: `${count} task${count !== 1 ? 's' : ''} created in queue`,
    detail: `Created ${count} task${count !== 1 ? 's' : ''} from objectives`,
    metadata: { count },
  });
}

export async function recordTaskAssigned(
  missionId: string,
  taskId: string,
  taskTitle: string,
  managerId: string,
  managerName: string,
  reason: string,
): Promise<void> {
  await recordEvent(missionId, 'task_assigned', {
    entityType: 'task',
    entityId: taskId,
    title: `Task assigned to ${managerName}`,
    detail: `${taskTitle} — ${reason}`,
    metadata: { managerId, reason },
  });
}

export async function recordTaskStarted(
  missionId: string,
  taskId: string,
  taskTitle: string,
  managerName: string,
): Promise<void> {
  await recordEvent(missionId, 'task_started', {
    entityType: 'task',
    entityId: taskId,
    title: `${managerName} started: ${taskTitle}`,
    detail: `Manager ${managerName} began execution`,
    metadata: { managerName },
  });
}

export async function recordTaskCompleted(
  missionId: string,
  taskId: string,
  taskTitle: string,
  managerName: string,
): Promise<void> {
  await recordEvent(missionId, 'task_completed', {
    entityType: 'task',
    entityId: taskId,
    title: `Completed: ${taskTitle}`,
    detail: `${managerName} finished execution`,
    metadata: { managerName },
  });
}

export async function recordTaskFailed(
  missionId: string,
  taskId: string,
  taskTitle: string,
  errorMessage: string,
): Promise<void> {
  await recordEvent(missionId, 'task_failed', {
    entityType: 'task',
    entityId: taskId,
    title: `Failed: ${taskTitle}`,
    detail: errorMessage,
    metadata: { error: errorMessage },
  });
}

export async function recordMissionCompleted(
  missionId: string,
  title: string,
  progress: number,
): Promise<void> {
  await recordEvent(missionId, 'mission_completed', {
    entityType: 'mission',
    entityId: missionId,
    title: `Mission completed: ${title}`,
    detail: `Progress: ${progress}%`,
    metadata: { progress },
  });
}

export async function recordMissionFailed(
  missionId: string,
  title: string,
  reason: string,
): Promise<void> {
  await recordEvent(missionId, 'mission_failed', {
    entityType: 'mission',
    entityId: missionId,
    title: `Mission failed: ${title}`,
    detail: reason,
    metadata: { reason },
  });
}

export async function recordMissionCancelled(
  missionId: string,
  title: string,
  reason: string,
): Promise<void> {
  await recordEvent(missionId, 'mission_cancelled', {
    entityType: 'mission',
    entityId: missionId,
    title: `Mission cancelled: ${title}`,
    detail: reason,
    metadata: { reason },
  });
}

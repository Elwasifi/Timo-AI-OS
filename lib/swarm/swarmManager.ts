// Phase 2 — Swarm Manager
//
// Receives ready tasks from the persistent task queue and assigns them
// to the correct manager using capability matching. The Swarm Manager
// is the dispatch brain — it does NOT execute tasks itself.
//
// Flow:
//   Ready Task → Capability Match → Find Manager → Assign → Update Task
//
// In Phase 2, managers execute tasks directly (no workers yet).
// In Phase 3, the Swarm Manager will also assign workers under each manager.

import { matchCapability } from './capabilityMatcher';
import { updateTask, appendExecutionLog } from './missionService';
import {
  recordTaskAssigned,
} from './missionTimeline';
import type { MissionTask, TaskAssignment, CapabilityMatch } from './types';

export interface DispatchResult {
  task: MissionTask;
  assignment: TaskAssignment | null;
  error: string | null;
}

export async function dispatchTask(
  task: MissionTask,
  missionId: string,
): Promise<DispatchResult> {
  const match = await matchCapability(task.requiredCapability);

  if (!match) {
    const updated = await updateTask(task.id, {
      status: 'failed',
      errorMessage: `No agent found with capability: ${task.requiredCapability}`,
      completedAt: new Date().toISOString(),
    });

    return {
      task: updated ?? task,
      assignment: null,
      error: `No agent found with capability: ${task.requiredCapability}`,
    };
  }

  const updatedTask = await updateTask(task.id, {
    status: 'ready',
    assignedManager: match.agent.id,
  });

  if (!updatedTask) {
    return {
      task,
      assignment: null,
      error: 'Failed to update task assignment in database',
    };
  }

  await appendExecutionLog(task.id, {
    timestamp: new Date().toISOString(),
    event: 'task_assigned',
    detail: `Assigned to ${match.agent.roleId} (${match.agent.role}) — ${match.reason}`,
    agentId: match.agent.id,
  });

  await recordTaskAssigned(
    missionId,
    task.id,
    task.title,
    match.agent.id,
    match.agent.displayName,
    match.reason,
  );

  const assignment: TaskAssignment = {
    task: updatedTask,
    assignedManager: match.agent,
    match,
    reason: match.reason,
  };

  return {
    task: updatedTask,
    assignment,
    error: null,
  };
}

export async function dispatchTasks(
  tasks: MissionTask[],
  missionId: string,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];

  for (const task of tasks) {
    if (task.status !== 'waiting' && task.status !== 'ready') {
      results.push({
        task,
        assignment: null,
        error: `Task is in ${task.status} state, skipping dispatch`,
      });
      continue;
    }

    const result = await dispatchTask(task, missionId);
    results.push(result);
  }

  return results;
}

export async function findManagerForTask(
  task: MissionTask,
): Promise<CapabilityMatch | null> {
  return matchCapability(task.requiredCapability);
}

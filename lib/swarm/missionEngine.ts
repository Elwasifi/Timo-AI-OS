// Phase 2 — Mission Engine
//
// The orchestrator that ties together the Mission Planner, Mission Service,
// Swarm Manager, and Timeline Tracker. It drives the full lifecycle:
//
//   User Request
//     → Create Mission
//     → Plan (classify complexity, generate objectives)
//     → Create Tasks from Objectives
//     → Dispatch Tasks via Swarm Manager
//     → (Managers execute — Phase 2 uses managers directly)
//     → Track Progress
//     → Record Timeline
//     → Return Result
//
// The engine does NOT replace the existing routing system (lib/crew/).
// It is a parallel orchestration layer. The existing CrewCoordinator
// continues to handle single-request routing. The Mission Engine handles
// multi-step mission decomposition.
//
// Integration point: a future phase will have Temo decide whether a request
// is simple (route via CrewCoordinator) or complex (launch a Mission via
// MissionEngine).

import {
  createMission,
  updateMission,
  createObjectives,
  createTasks,
  getFullMission,
  updateTask,
  appendExecutionLog,
  recordLesson,
  claimMissionTerminalStatus,
} from './missionService';
import {
  planMission,
  estimatePriority,
  classifyComplexity,
} from './missionPlanner';
import { dispatchTasks } from './swarmManager';
import { checkEntitlement, consumeProjectSlot, checkBudget } from '@/lib/governance/entitlements';
import {
  recordMissionCreated,
  recordMissionPlanned,
  recordObjectivesGenerated,
  recordTasksCreated,
  recordTaskStarted,
  recordTaskCompleted,
  recordTaskFailed,
  recordMissionCompleted,
  recordMissionFailed,
  recordMissionCancelled,
} from './missionTimeline';
import type {
  Mission,
  MissionObjective,
  MissionTask,
  MissionPlan,
  MissionExecutionResult,
  MissionPriority,
  TimelineEntry,
  TaskAssignment,
} from './types';

export interface CreateMissionInput {
  userRequest: string;
  title?: string;
  objective?: string;
  priority?: MissionPriority;
  parentMissionId?: string | null;
  /** Required — every mission belongs to a tenant. */
  tenantId: string;
  /** V1 (Section 12): simulation missions never trigger real external side effects and don't consume package entitlements. */
  isSimulation?: boolean;
}

export interface LaunchMissionError {
  code: 'entitlement_denied' | 'budget_exceeded';
  reason: string;
}

export async function launchMission(
  input: CreateMissionInput,
): Promise<MissionExecutionResult | LaunchMissionError | null> {
  // 0a. Entitlement check (Section 14) — simulation missions are exempt,
  // they don't consume a client's project/credit allowance.
  if (!input.isSimulation) {
    const entitlement = await checkEntitlement(input.tenantId);
    if (!entitlement.allowed) {
      return { code: 'entitlement_denied', reason: entitlement.reason ?? 'Package limit reached.' };
    }
  }

  // 0b. Budget hard-gate (Section 3C) — a real pre-spend check against
  // configured monthly limits. Applies even to simulation missions: "no
  // real external side effects" (lib/tools/executor.ts) covers tool
  // execution only — simulation missions still make real, billable AI
  // provider calls. Tenants with no budgets row configured are unaffected
  // (checkBudget returns withinBudget:true, limitUsd:null) — this never
  // blocks anyone who hasn't opted into a budget.
  const budget = await checkBudget(input.tenantId);
  if (!budget.withinBudget) {
    return {
      code: 'budget_exceeded',
      reason: `Monthly AI budget exceeded ($${budget.spendUsd.toFixed(2)} / $${budget.limitUsd?.toFixed(2)}). Raise the budget in Settings or wait for the next billing period.`,
    };
  }

  // 1. Classify and plan
  const priority = input.priority ?? estimatePriority(input.userRequest);
  const plan = planMission(input.userRequest, priority);
  const title =
    input.title ?? deriveTitle(input.userRequest);
  const objective =
    input.objective ?? input.userRequest;

  // 2. Create mission record
  const mission = await createMission({
    title,
    objective,
    userRequest: input.userRequest,
    priority,
    estimatedComplexity: plan.complexity,
    estimatedTasks: plan.estimatedTasks,
    parentMissionId: input.parentMissionId ?? null,
    tenantId: input.tenantId,
    isSimulation: input.isSimulation ?? false,
  });

  if (!mission) {
    console.error('[mission-engine] Failed to create mission');
    return null;
  }

  if (!input.isSimulation) {
    await consumeProjectSlot(input.tenantId);
  }

  await recordMissionCreated(mission.id, mission.title, input.userRequest);

  // 3. Update status to planning
  await updateMission(mission.id, { status: 'planning' });

  // 4. Record the plan
  await recordMissionPlanned(mission.id, plan.complexity, plan.estimatedTasks);

  // 5. Create objectives from plan
  const objectiveInputs = plan.objectives.map((obj, i) => ({
    title: obj.title,
    requiredCapability: obj.requiredCapability,
    estimatedEffort: obj.estimatedEffort,
    dependencies: obj.dependencies,
    sortOrder: i,
  }));

  const objectives = await createObjectives(mission.id, objectiveInputs);
  await recordObjectivesGenerated(mission.id, objectives.length);

  // 6. Create tasks from objectives
  await updateMission(mission.id, { status: 'ready' });

  const taskInputs = objectives.map((obj) => ({
    objectiveId: obj.id,
    requiredCapability: obj.requiredCapability,
    title: obj.title,
    description: `Execute objective: ${obj.title} (capability: ${obj.requiredCapability})`,
    priority,
    dependencies: obj.dependencies,
  }));

  const tasks = await createTasks(mission.id, taskInputs);
  await recordTasksCreated(mission.id, tasks.length);

  // 7. Dispatch tasks via Swarm Manager
  await updateMission(mission.id, { status: 'executing' });

  const dispatchResults = await dispatchTasks(tasks, mission.id);
  const assignments: TaskAssignment[] = [];

  for (const result of dispatchResults) {
    if (result.assignment) {
      assignments.push(result.assignment);
    }
  }

  // 8. Update progress based on dispatch
  const dispatchedCount = assignments.length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((dispatchedCount / totalTasks) * 50) : 0;

  await updateMission(mission.id, { progress });

  // 9. Fetch final state
  const full = await getFullMission(mission.id);
  const finalMission = full.mission ?? mission;
  const finalObjectives = full.objectives.length > 0 ? full.objectives : objectives;
  const finalTasks = full.tasks.length > 0 ? full.tasks : tasks;
  const timeline = full.timeline;

  // 10. Determine final status
  const allAssigned = dispatchedCount === totalTasks;
  const finalStatus = allAssigned ? 'executing' : 'executing';

  const summary = buildSummary(
    finalMission,
    plan,
    finalObjectives,
    finalTasks,
    assignments,
  );

  return {
    mission: finalMission,
    objectives: finalObjectives,
    tasks: finalTasks,
    timeline,
    assignments,
    finalStatus,
    summary,
  };
}

export async function getMissionStatus(
  missionId: string,
): Promise<MissionExecutionResult | null> {
  const full = await getFullMission(missionId);
  if (!full.mission) return null;

  const assignments: TaskAssignment[] = [];
  // Reconstruct assignments from task data
  for (const task of full.tasks) {
    if (task.assignedManager) {
      // We don't have the full AgentRecord here, but the assignment
      // metadata is captured in the task and timeline
      assignments.push({
        task,
        assignedManager: {
          id: task.assignedManager,
          displayName: task.assignedManager,
          role: '',
          level: 'manager',
          departmentId: null,
          description: '',
          capabilities: [],
          permissions: {},
          avatar: '',
          avatarUrl: null,
          themeColor: '',
          status: 'available',
          systemPromptTemplate: '',
          model: '',
          isActive: true,
          sortOrder: 0,
          parentId: null,
          childrenIds: [],
          priority: 0,
          tools: [],
          createdAt: '',
          updatedAt: '',
        },
        match: {
          agent: {
            id: task.assignedManager,
            displayName: task.assignedManager,
            role: '',
            level: 'manager',
            departmentId: null,
            description: '',
            capabilities: [],
            permissions: {},
            avatar: '',
          avatarUrl: null,
            themeColor: '',
            status: 'available',
            systemPromptTemplate: '',
            model: '',
            isActive: true,
            sortOrder: 0,
            parentId: null,
            childrenIds: [],
            priority: 0,
            tools: [],
            createdAt: '',
            updatedAt: '',
          },
          score: 1,
          matchedCapabilities: [task.requiredCapability],
          reason: 'Reconstructed from task record',
        },
        reason: 'Reconstructed from task record',
      });
    }
  }

  const summary = buildSummary(
    full.mission,
    null,
    full.objectives,
    full.tasks,
    assignments,
  );

  return {
    mission: full.mission,
    objectives: full.objectives,
    tasks: full.tasks,
    timeline: full.timeline,
    assignments,
    finalStatus: full.mission.status,
    summary,
  };
}

export async function completeTask(
  missionId: string,
  taskId: string,
  result: Record<string, unknown>,
  managerName: string,
  taskTitle: string,
): Promise<void> {
  await updateTask(taskId, {
    status: 'completed',
    result,
    completedAt: new Date().toISOString(),
  });

  await appendExecutionLog(taskId, {
    timestamp: new Date().toISOString(),
    event: 'task_completed',
    detail: `Task completed by ${managerName}`,
  });

  await recordTaskCompleted(missionId, taskId, taskTitle, managerName);

  // Recalculate mission progress
  await recalculateProgress(missionId);
}

export async function failTask(
  missionId: string,
  taskId: string,
  errorMessage: string,
  taskTitle: string,
): Promise<void> {
  await updateTask(taskId, {
    status: 'failed',
    errorMessage,
    completedAt: new Date().toISOString(),
  });

  await recordTaskFailed(missionId, taskId, taskTitle, errorMessage);

  await recalculateProgress(missionId);
}

export async function startTask(
  missionId: string,
  taskId: string,
  managerName: string,
  taskTitle: string,
): Promise<void> {
  await updateTask(taskId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  await recordTaskStarted(missionId, taskId, taskTitle, managerName);
}

// Exported so executionLayer.ts's executeTask() can roll a task-status
// change up into the mission row regardless of which path executed the
// task (synchronous in-request pipeline, or the background task queue —
// the latter previously never called this, so queue-executed missions
// could stay stuck at status:'executing' forever even after every task
// finished).
export async function recalculateProgress(missionId: string): Promise<void> {
  const full = await getFullMission(missionId);
  if (!full.mission) return;

  const total = full.tasks.length;
  if (total === 0) return;

  const completed = full.tasks.filter((t) => t.status === 'completed').length;
  const failed = full.tasks.filter((t) => t.status === 'failed').length;
  const progress = Math.round(((completed + failed) / total) * 100);

  let status: Mission['status'] = full.mission.status;
  if (completed + failed === total) {
    status = 'completed';
    if (failed > 0 && completed === 0) {
      status = 'failed';
    }

    // M5-04: claim the terminal transition atomically before running any
    // side effects — if this returns false, a concurrent call already
    // transitioned this mission out of non-terminal status first, so the
    // completion/failure bookkeeping below has already run once for this
    // mission and must not run again.
    const claimed = await claimMissionTerminalStatus(missionId, status, 100);
    if (!claimed) return;

    if (status === 'failed') {
      await recordMissionFailed(missionId, full.mission.title, `${failed} of ${total} tasks failed`);

      const errors = full.tasks
        .filter((t) => t.status === 'failed' && t.errorMessage)
        .map((t) => `${t.title}: ${t.errorMessage}`)
        .slice(0, 5)
        .join('; ');
      await recordLesson({
        tenantId: full.mission.tenantId,
        missionId,
        category: 'mission_failure',
        summary: `Mission "${full.mission.title}" failed — ${failed} of ${total} tasks failed`,
        detail: errors,
        outcome: 'failure',
      });
    } else {
      await recordMissionCompleted(missionId, full.mission.title, 100);

      // Partial failure: the mission still resolves 'completed' because at
      // least one task succeeded, but some tasks genuinely failed along the
      // way — a real signal worth capturing, unlike a fully clean run.
      if (failed > 0) {
        const errors = full.tasks
          .filter((t) => t.status === 'failed' && t.errorMessage)
          .map((t) => `${t.title}: ${t.errorMessage}`)
          .slice(0, 5)
          .join('; ');
        await recordLesson({
          tenantId: full.mission.tenantId,
          missionId,
          category: 'partial_failure',
          summary: `Mission "${full.mission.title}" completed with ${failed} of ${total} tasks failing`,
          detail: errors,
          outcome: 'partial',
        });
      }
    }
    return;
  }

  await updateMission(missionId, { progress, status });
}

const TERMINAL_MISSION_STATUSES: Mission['status'][] = ['completed', 'failed', 'cancelled'];
const NON_TERMINAL_TASK_STATUSES: MissionTask['status'][] = ['waiting', 'ready', 'running'];

/**
 * User-initiated mission cancellation (CLAUDE.md: human authority must
 * remain above autonomous execution — before this function existed, a
 * launched mission had no way to be stopped by the user at all).
 *
 * Cooperative, not preemptive: a task currently executing in-process
 * (inside executionLayer.ts's retry loop, in this request or another
 * server instance) is not interrupted mid-call — there is no cross-request
 * signal for that without introducing new orchestration machinery. This
 * only prevents FUTURE work: non-terminal tasks are marked 'cancelled' so
 * claim_ready_tasks()/claimTask() can never pick them up, and the mission
 * itself is marked 'cancelled' so recalculateProgress() won't resurrect it.
 */
export async function cancelMission(
  missionId: string,
  tenantId: string,
  reason = 'Cancelled by user',
): Promise<{ success: boolean; error?: string }> {
  const full = await getFullMission(missionId);
  if (!full.mission) return { success: false, error: 'Mission not found' };
  if (full.mission.tenantId !== tenantId) return { success: false, error: 'Mission not found' };
  if (TERMINAL_MISSION_STATUSES.includes(full.mission.status)) {
    return { success: false, error: `Mission is already ${full.mission.status}` };
  }

  await Promise.all(
    full.tasks
      .filter((t) => NON_TERMINAL_TASK_STATUSES.includes(t.status))
      .map((t) => updateTask(t.id, { status: 'cancelled', completedAt: new Date().toISOString() })),
  );

  await updateMission(missionId, { status: 'cancelled' });
  await recordMissionCancelled(missionId, full.mission.title, reason);

  return { success: true };
}

function deriveTitle(userRequest: string): string {
  const trimmed = userRequest.trim();
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 57) + '...';
}

function buildSummary(
  mission: Mission,
  plan: MissionPlan | null,
  objectives: MissionObjective[],
  tasks: MissionTask[],
  assignments: TaskAssignment[],
): string {
  const complexity = plan?.complexity ?? mission.estimatedComplexity;
  const objCount = objectives.length;
  const taskCount = tasks.length;
  const assignedCount = assignments.length;

  return [
    `Mission: ${mission.title}`,
    `Complexity: ${complexity} | Priority: ${mission.priority}`,
    `Objectives: ${objCount} | Tasks: ${taskCount} | Assigned: ${assignedCount}`,
    assignments.length > 0
      ? `Managers involved: ${Array.from(new Set(assignments.map((a) => a.assignedManager.displayName))).join(', ')}`
      : 'No managers assigned yet',
  ].join('\n');
}

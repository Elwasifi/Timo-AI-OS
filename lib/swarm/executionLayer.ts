// Phase 3 — Execution Layer
//
// Receives tasks from the Swarm Manager and executes them using existing
// systems. The Execution Layer NEVER duplicates functionality — it
// orchestrates existing modules in the correct order:
//
//   Task → Assigned Manager → Tool Engine (if needed) →
//   Workflow Engine (if needed) → Knowledge Engine (if needed) →
//   Memory Engine (if needed) → LLM Provider (if needed) →
//   Result → Timeline → Mission
//
// Retry & Failure Handling:
//   - Each task has maxRetries (default 3)
//   - On failure, the task is retried up to maxRetries
//   - After exhausting retries, the task fails gracefully
//   - A timeout prevents hung tasks (default 30s)
//   - Failures never crash the mission — the mission continues
//   - Partial completion is supported (some tasks succeed, some fail)
//
// Manager → Worker delegation:
//   When the assigned manager has a matching worker (findWorkerForTask),
//   execution goes through executeDelegatedTask() below, which calls the
//   SAME lib/crew/manager-delegation.ts core the chat pipeline uses —
//   AGENT_TO_AGENT-routed worker execution, then a real manager review
//   whose output becomes the task's final result. No worker match falls
//   back to direct manager execution, unchanged.

import { chatWithFallback, type ChatMessage } from '@/lib/ai/ai-provider';
import { route, classifyTask } from '@/lib/ai/router';
import { loadSettings } from '@/lib/settings/settings-service';
import { getAgentById } from '@/lib/agents/agentRegistryService';
import { executeWorker, managerReview, type WorkerTask } from '@/lib/crew/manager-delegation';
import { buildManagerContext } from './managerContext';
import { updateTask, claimTask, appendExecutionLog, getTasks, updateMission } from './missionService';
import { recalculateProgress } from './missionEngine';
import {
  recordEvent,
  recordTaskStarted,
  recordTaskCompleted,
  recordTaskFailed,
} from './missionTimeline';
import { emitRuntimeEvent } from './runtimeStore';
import { findWorkerForTask, resolveRoleId } from './workerRouter';
import type { MissionTask, Mission, MissionObjective } from './types';
import type { ExecutionResult, ExecutionStep, ExecutionContext, PriorTaskResult, ManagerContext } from './executionTypes';
import type { AgentRecord } from '@/lib/agents/types';

// ---- Timeout helper ----

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Task timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---- Single Task Execution ----

export async function executeTask(
  task: MissionTask,
  mission: Mission,
  objective: MissionObjective | null,
  priorResults: PriorTaskResult[] = [],
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const steps: ExecutionStep[] = [];
  const managerId = task.assignedManager ?? 'temo';
  const managerName = managerId;

  // Resolve the manager's stable roleId from the agent registry
  const managerRecord = await getAgentById(managerId);
  const managerRoleId = resolveRoleId(managerRecord);

  // Attempt role-based worker selection for this manager's hierarchy
  const workerMatch = await findWorkerForTask(managerId, task.requiredCapability);
  const workerRecord: AgentRecord | null = workerMatch?.agent ?? null;
  const workerId = workerRecord?.id ?? null;
  const workerRoleId = workerRecord ? resolveRoleId(workerRecord) : null;

  // Atomically claim the task (status must currently be 'ready'/'waiting').
  // Guards against double execution when both the synchronous mission
  // pipeline and the background task-queue processor pick up the same
  // task — whichever caller wins the UPDATE proceeds; the other bails out
  // immediately below instead of re-running the same work.
  const claimed = await claimTask(task.id, workerId);
  if (!claimed) {
    return {
      taskId: task.id,
      missionId: mission.id,
      managerId,
      managerName,
      managerRoleId,
      workerId,
      workerRoleId,
      delegated: false,
      status: 'cancelled',
      output: '',
      result: {},
      error: 'Task already claimed by another executor',
      retries: 0,
      durationMs: Date.now() - startTime,
      steps,
    };
  }
  await recordTaskStarted(mission.id, task.id, task.title, managerName);
  await recordEvent(mission.id, 'execution_started', {
    entityType: 'task',
    entityId: task.id,
    title: `Execution started: ${task.title}`,
    detail: workerId
      ? `Manager: ${managerName} → Worker: ${workerId}`
      : `Manager: ${managerName} (direct execution)`,
  });

  await appendExecutionLog(task.id, {
    timestamp: new Date().toISOString(),
    event: 'execution_started',
    detail: workerId
      ? `Execution started by ${managerName} → delegated to ${workerId}`
      : `Execution started by ${managerName} (direct)`,
    agentId: managerId,
  });

  // Emit executing runtime event — accurately report whether a worker is acting
  await emitRuntimeEvent({
    eventType: 'executing',
    agentId: managerId,
    workerId,
    missionId: mission.id,
    taskId: task.id,
    timestamp: new Date().toISOString(),
    status: 'active',
    title: workerId
      ? `Delegated: ${task.title}`
      : `Executing: ${task.title}`,
    detail: workerId
      ? `Manager: ${managerName} → Worker: ${workerId}`
      : `Manager: ${managerName} (direct LLM fallback)`,
    metadata: {
      managerRoleId,
      ...(workerId && workerRoleId ? { workerId, workerRoleId } : {}),
      delegated: workerId !== null,
    },
  });

  let retries = 0;
  const maxRetries = task.maxRetries || 3;
  const timeoutMs = (task as MissionTask & { task_timeout_ms?: number }).task_timeout_ms ?? 30000;

  while (retries <= maxRetries) {
    try {
      // Build manager context (memory, knowledge, tools, workflows, prior results)
      const ctxStep = trackStep('Context Building', async () => {
        const ctx = await buildManagerContext(task, mission, objective, priorResults);
        if (!ctx) throw new Error('Failed to build manager context');
        return ctx;
      });
      const ctxResult = await ctxStep;
      steps.push(ctxResult.step);

      if (ctxResult.value.relevantMemory) {
        await recordEvent(mission.id, 'memory_retrieved', {
          entityType: 'task',
          entityId: task.id,
          title: 'Memory retrieved for context',
          detail: ctxResult.value.relevantMemory.slice(0, 200),
        });
      }

      if (ctxResult.value.relevantKnowledge) {
        await recordEvent(mission.id, 'knowledge_retrieved', {
          entityType: 'task',
          entityId: task.id,
          title: 'Knowledge retrieved for context',
          detail: ctxResult.value.relevantKnowledge.slice(0, 200),
        });
      }

      // Execute via LLM provider with timeout
      // When a valid worker exists in the manager's hierarchy, delegate
      // through the SAME manager-delegation core the chat pipeline uses
      // (lib/crew/manager-delegation.ts) — real AGENT_TO_AGENT routing for
      // the worker turn, followed by a real manager review whose output
      // becomes the task's final result. Otherwise, fall back to direct
      // manager LLM execution (the existing behavior, unchanged).
      const llmStep = await trackStep(
        workerId ? 'Worker Execution' : 'LLM Execution',
        async () => {
          const settings = await loadSettings();

          if (workerId && workerRecord) {
            // Worker execution and manager review are each independently
            // timeout-bounded inside executeDelegatedTask (matching the
            // original single-call budget) rather than sharing one combined
            // budget here — two sequential LLM calls under one timeoutMs
            // would time out far more often than either call alone did.
            return executeDelegatedTask(mission, task, managerId, managerName, managerRecord, workerRecord, ctxResult.value, timeoutMs);
          }

          const systemPrompt = ctxResult.value.systemPrompt;
          const messages: ChatMessage[] = [
            { role: 'user', content: ctxResult.value.userPrompt },
          ];

          // Dynamic Model Router: classify this task and let the router pick
          // provider+model instead of always using whatever app_settings has
          // globally configured. Never throws — route() degrades to an empty
          // candidate list on any failure, which chatWithFallback treats
          // exactly like today's un-routed behavior (see resolveOrderedPairs
          // in lib/ai/ai-provider.ts).
          const classification = classifyTask({
            text: `${task.title}. ${task.description}`,
            isMissionTask: true,
            missionComplexity: mission.estimatedComplexity,
            requiredCapability: task.requiredCapability,
          });
          const decision = await route({ classification, tenantId: mission.tenantId });

          await recordEvent(mission.id, 'provider_selected', {
            entityType: 'task',
            entityId: task.id,
            title: decision.selected
              ? `Provider: ${decision.selected.provider}`
              : `Provider: ${settings.active_provider} (router fallback)`,
            detail: decision.selected
              ? `Model: ${decision.selected.model} — ${decision.reason}`
              : `Model: ${ctxResult.value.agent.model}`,
          });

          const result = await withTimeout(
            chatWithFallback(messages, {
              systemPrompt,
              temperature: settings.temperature,
              maxTokens: settings.max_tokens,
              candidates: decision.candidates,
              usageContext: {
                operation: 'mission_task',
                missionId: mission.id,
                taskId: task.id,
                agentId: managerId,
                managerId,
                tenantId: mission.tenantId,
                metadata: { taskType: decision.taskType, routingMode: decision.mode },
              },
            }),
            timeoutMs,
          );

          return result.content;
        },
      );
      steps.push(llmStep.step);

      // Success — record completion
      const output = llmStep.value;
      const durationMs = Date.now() - startTime;

      await updateTask(task.id, {
        status: 'completed',
        result: { output, steps: steps.map((s) => ({ step: s.step, status: s.status, detail: s.detail })) },
        completedAt: new Date().toISOString(),
      });

      await recordTaskCompleted(mission.id, task.id, task.title, managerName);
      await recordEvent(mission.id, 'execution_finished', {
        entityType: 'task',
        entityId: task.id,
        title: `Execution finished: ${task.title}`,
        detail: `Completed in ${durationMs}ms after ${retries} retry(ies)`,
        metadata: { durationMs, retries },
      });

      await appendExecutionLog(task.id, {
        timestamp: new Date().toISOString(),
        event: 'execution_finished',
        detail: `Completed in ${durationMs}ms`,
        agentId: managerId,
      });

      // Emit completed runtime event — accurately report who executed
      await emitRuntimeEvent({
        eventType: 'completed',
        agentId: managerId,
        workerId,
        missionId: mission.id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        status: 'completed',
        title: workerId
          ? `Task completed (delegated): ${task.title}`
          : `Task completed: ${task.title}`,
        detail: `Completed in ${durationMs}ms after ${retries} retry(ies)`,
        metadata: {
          durationMs,
          retries,
          managerRoleId,
          ...(workerId && workerRoleId ? { workerId, workerRoleId } : {}),
          delegated: workerId !== null,
        },
      });

      return {
        taskId: task.id,
        missionId: mission.id,
        managerId,
        managerName,
        managerRoleId,
        workerId,
        workerRoleId,
        delegated: workerId !== null,
        status: 'completed',
        output,
        result: { output, steps: steps.map((s) => ({ step: s.step, status: s.status, detail: s.detail })) },
        error: null,
        retries,
        durationMs,
        steps,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown execution error';
      retries++;

      await appendExecutionLog(task.id, {
        timestamp: new Date().toISOString(),
        event: 'execution_failed',
        detail: `Attempt ${retries}/${maxRetries + 1} failed: ${errorMessage}`,
        agentId: managerId,
      });

      if (retries <= maxRetries) {
        await recordEvent(mission.id, 'execution_retried', {
          entityType: 'task',
          entityId: task.id,
          title: `Retrying: ${task.title}`,
          detail: `Attempt ${retries + 1}/${maxRetries + 1} after: ${errorMessage}`,
          metadata: { retry: retries, error: errorMessage },
        });

        steps.push({
          step: `Retry ${retries}`,
          status: 'failed',
          detail: errorMessage,
          durationMs: 0,
        });

        // Exponential backoff
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, retries - 1), 8000)));
      } else {
        // Exhausted retries — fail gracefully
        const durationMs = Date.now() - startTime;
        await updateTask(task.id, {
          status: 'failed',
          errorMessage,
          completedAt: new Date().toISOString(),
          retries: retries - 1,
        });

        await recordTaskFailed(mission.id, task.id, task.title, errorMessage);
        await recordEvent(mission.id, 'execution_failed', {
          entityType: 'task',
          entityId: task.id,
          title: `Execution failed: ${task.title}`,
          detail: errorMessage,
          metadata: { error: errorMessage, retries: retries - 1, durationMs },
        });

        // Emit failed runtime event — accurately report who was executing
        await emitRuntimeEvent({
          eventType: 'failed',
          agentId: managerId,
          workerId,
          missionId: mission.id,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          status: 'failed',
          title: workerId
            ? `Task failed (delegated): ${task.title}`
            : `Task failed: ${task.title}`,
          detail: errorMessage,
          metadata: {
            error: errorMessage,
            retries: retries - 1,
            durationMs,
            managerRoleId,
            ...(workerId && workerRoleId ? { workerId, workerRoleId } : {}),
            delegated: workerId !== null,
          },
        });

        return {
          taskId: task.id,
          missionId: mission.id,
          managerId,
          managerName,
          managerRoleId,
          workerId,
          workerRoleId,
          delegated: workerId !== null,
          status: 'failed',
          output: '',
          result: {},
          error: errorMessage,
          retries: retries - 1,
          durationMs,
          steps,
        };
      }
    }
  }

  // Should not reach here, but just in case
  return {
    taskId: task.id,
    missionId: mission.id,
    managerId,
    managerName,
    managerRoleId,
    workerId,
    workerRoleId,
    delegated: workerId !== null,
    status: 'failed',
    output: '',
    result: {},
    error: 'Unexpected execution termination',
    retries,
    durationMs: Date.now() - startTime,
    steps,
  };
}

// ---- Execute All Tasks for a Mission ----

export async function executeMissionTasks(
  mission: Mission,
  tasks: MissionTask[],
  objectives: MissionObjective[],
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  const priorResults: PriorTaskResult[] = [];

  // Execute tasks sequentially (parallel execution is Phase 4)
  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') {
      continue;
    }

    const objective = objectives.find((o) => o.id === task.objectiveId) ?? null;
    const result = await executeTask(task, mission, objective, [...priorResults]);
    results.push(result);

    // Thread completed results to subsequent tasks so review/synthesis
    // agents see the actual worker output
    if (result.status === 'completed' && result.output) {
      priorResults.push({
        taskId: result.taskId,
        taskTitle: task.title,
        managerId: result.managerId,
        managerRoleId: resolveRoleId(await getAgentById(result.managerId)),
        workerId: result.workerId ?? null,
        workerRoleId: result.workerRoleId ?? null,
        output: result.output,
        status: 'completed',
      });
    }

    // Update mission progress after each task
    const completedCount = results.filter((r) => r.status === 'completed').length;
    const totalCount = tasks.length;
    const progress = Math.round(((completedCount) / totalCount) * 100);
    await updateMission(mission.id, { progress });
    await recordEvent(mission.id, 'mission_updated', {
      entityType: 'mission',
      entityId: mission.id,
      title: `Mission progress: ${progress}%`,
      detail: `${completedCount}/${totalCount} tasks completed`,
      metadata: { progress, completed: completedCount, total: totalCount },
    });

    // Roll the mission's own status to a terminal value once every task has
    // resolved — this loop only ever wrote progress, never status, so a
    // mission executed synchronously (the primary chat/voice path) could
    // reach 100% progress and stay stuck at 'executing' forever. Confirmed
    // live: a real mission with both tasks 'completed' was still sitting at
    // status 'executing'. recalculateProgress() (missionEngine.ts) is the
    // same rollup the background queue processor already calls after each
    // task — reusing it here (rather than duplicating its status logic)
    // also picks up its mission_completed/mission_failed timeline events and
    // lessons-learned recording for free.
    await recalculateProgress(mission.id);
  }

  return results;
}

// ---- Manager → Worker Delegation (Mission pipeline) ----
//
// Real delegation, not a decorative branch: the worker turn is classified
// and routed as AGENT_TO_AGENT via lib/crew/manager-delegation.ts's shared
// executeWorker(), then the manager reviews the worker's result via the
// same module's managerReview(), and the REVIEWED content — not the raw
// worker output — becomes the task's final result. A worker failure
// throws so the existing retry/backoff loop in executeTask() handles it
// exactly like any other execution failure; a review failure is caught
// and logged, falling back to the worker's raw (already-valid) result
// rather than failing an otherwise-successful task.

async function executeDelegatedTask(
  mission: Mission,
  task: MissionTask,
  managerId: string,
  managerName: string,
  managerRecord: AgentRecord | null,
  workerRecord: AgentRecord,
  ctx: ManagerContext,
  timeoutMs: number,
): Promise<string> {
  const workerTask: WorkerTask = {
    taskId: task.id,
    missionId: mission.id,
    originalObjective: task.description || mission.objective,
    delegatedTask: task.title,
    context: ctx.userPrompt,
    parentManagerId: managerId,
    requiredCapabilities: workerRecord.capabilities,
    acceptanceCriteria: [
      'Solution addresses the original objective',
      'Response is clear, actionable, and directly usable',
    ],
  };
  const workerSystemPrompt = buildWorkerSystemPrompt(ctx.systemPrompt, workerRecord);

  const { result: workerResult, decision: workerDecision } = await withTimeout(
    executeWorker(workerTask, workerRecord, mission.tenantId, undefined, workerSystemPrompt),
    timeoutMs,
  );

  await recordEvent(mission.id, 'provider_selected', {
    entityType: 'task',
    entityId: task.id,
    title: workerDecision.selected
      ? `Provider: ${workerDecision.selected.provider}`
      : `Provider: worker execution (router fallback)`,
    detail: workerDecision.selected
      ? `Model: ${workerDecision.selected.model} — ${workerDecision.reason}`
      : `Model: ${workerRecord.model} (Worker: ${workerRecord.roleId})`,
  });

  if (workerResult.status === 'failed') {
    // Re-thrown so executeTask()'s existing retry/backoff loop applies —
    // preserves current retry behavior for delegated tasks unchanged.
    throw new Error(workerResult.errors.join('; ') || 'Worker execution failed');
  }

  if (!managerRecord) {
    // No registered manager agent to review with — use the worker's
    // result directly rather than fabricating a reviewer.
    return workerResult.result;
  }

  await recordEvent(mission.id, 'review_started', {
    entityType: 'task',
    entityId: task.id,
    title: `${managerName} reviewing ${workerRecord.displayName}'s result`,
    detail: `Reviewing output for: ${task.title}`,
  });

  try {
    const { content: reviewedOutput, decision: reviewDecision } = await withTimeout(
      managerReview(
        managerRecord,
        workerResult,
        `${task.title}. ${task.description}`,
        ctx.relevantMemory || ctx.relevantKnowledge || '',
        mission.tenantId,
        mission.id,
        task.id,
      ),
      timeoutMs,
    );

    await recordEvent(mission.id, 'review_completed', {
      entityType: 'task',
      entityId: task.id,
      title: `${managerName} review complete`,
      detail: reviewDecision.selected
        ? `Model: ${reviewDecision.selected.model} — finalized ${workerRecord.displayName}'s result`
        : `${managerName} finalized ${workerRecord.displayName}'s result`,
      metadata: { taskType: reviewDecision.taskType, routingMode: reviewDecision.mode },
    });

    return reviewedOutput;
  } catch (err) {
    // Review failing shouldn't fail an otherwise-successful task — mirrors
    // the chat pipeline's existing forgiving fallback (manager-delegation.ts).
    const message = err instanceof Error ? err.message : 'Manager review failed';
    await recordEvent(mission.id, 'review_completed', {
      entityType: 'task',
      entityId: task.id,
      title: `${managerName} review failed — using worker result directly`,
      detail: message,
      metadata: { reviewFailed: true },
    });
    return workerResult.result;
  }
}

// ---- Worker System Prompt Builder ----

function buildWorkerSystemPrompt(
  basePrompt: string,
  worker: AgentRecord,
): string {
  const workerHeader =
    `You are ${worker.displayName}, ${worker.role} (roleId: ${worker.roleId}). ` +
    `You are executing a task delegated by your department manager. ` +
    `Your capabilities: ${worker.capabilities.join(', ')}. ` +
    `Stay focused on the task and provide a complete, actionable result.\n\n`;
  return `${workerHeader}${basePrompt}`;
}

// ---- Step Tracking Helper ----

async function trackStep<T>(
  stepName: string,
  fn: () => Promise<T>,
): Promise<{ step: ExecutionStep; value: T }> {
  const start = Date.now();
  try {
    const value = await fn();
    return {
      step: {
        step: stepName,
        status: 'completed',
        detail: 'Success',
        durationMs: Date.now() - start,
      },
      value,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const error = new Error(message);
    (error as Error & { step: ExecutionStep }).step = {
      step: stepName,
      status: 'failed',
      detail: message,
      durationMs: Date.now() - start,
    };
    throw error;
  }
}

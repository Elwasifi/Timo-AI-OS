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

import { route, classifyTask } from '@/lib/ai/router';
import { runAgentLoop } from './agentLoop';
import { loadSettings } from '@/lib/settings/settings-service';
import { getAgentById } from '@/lib/agents/agentRegistryService';
import { executeWorker, managerReview, type WorkerTask } from '@/lib/crew/manager-delegation';
import { detectIntent } from '@/lib/context/intent-detector';
import { decideTools } from '@/lib/context/tool-decision';
import { buildManagerContext } from './managerContext';
import { updateTask, claimTask, appendExecutionLog, getTasks } from './missionService';
import { recalculateProgress, recalculateObjectiveStatus } from './missionEngine';
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
import type { Intent } from '@/types';

// ---- Result-shape guard (M5-02) ----
//
// Verifies a task's result actually reads as an answer, not empty/blank
// output or raw JSON values (the shape of tool-call arguments, not
// prose) — the specific fake-success shape that reached 'completed'
// status live. Deliberately a shape check, not a content/quality check:
// this isn't trying to judge whether the answer is GOOD, only whether
// it's structurally an answer at all.
//
// Checking whether the WHOLE trimmed string parses as one JSON value
// isn't enough — live-confirmed the actual degenerate output was TWO
// JSON objects concatenated across lines (one per retry attempt, e.g.
// `{"queries":[...]}\n{"queries":[...]}`), which fails a single
// JSON.parse() on the combined string (trailing-data error) and would
// have slipped past that check as "not JSON, must be prose." Splitting
// into lines and checking whether EVERY non-blank line individually
// parses as JSON catches that shape too, while still accepting a real
// answer that happens to quote a JSON snippet inside otherwise-prose
// text (not every line of that would parse as JSON on its own).
//
// Known limitation: this rejects ANY output that is entirely valid JSON,
// regardless of intent. Correct for every task type today (research,
// analysis, review, synthesis, etc. all produce prose) — but a future
// task whose legitimate purpose is to return structured JSON (e.g. "give
// me this as a JSON object") would be incorrectly rejected by this guard
// as if it were degenerate. No such task exists today, so no behavior
// change is needed now — noted here so it isn't rediscovered as a
// surprise later. If that need arises, the guard should take the task's
// expected output shape into account rather than assuming prose always.
function looksLikeRealAnswer(output: string): boolean {
  const trimmed = output.trim();
  if (trimmed.length === 0) return false;

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isJsonLine = (line: string): boolean => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  };

  return !(lines.length > 0 && lines.every(isJsonLine));
}

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

  // Resolve the manager's stable identifier from the agent registry
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
  // M7-01 follow-up: raised from 30000 to 90000 after this session's own
  // live E2E test empirically hit the 30s default twice on a genuinely
  // multi-step agent-loop task (real timestamps: two of four whole-task
  // retries failed with "Task timed out after 30000ms" mid-loop, not from
  // a slow/broken call — the loop itself legitimately needed more wall
  // time once resumed from a checkpoint with several prior steps already
  // in context). Kept in sync with mission_tasks.task_timeout_ms's DB
  // column default (see 20260904160000_raise_task_timeout_default.sql).
  const timeoutMs = (task as MissionTask & { task_timeout_ms?: number }).task_timeout_ms ?? 90000;

  while (retries <= maxRetries) {
    try {
      // Tool Decision — same gate the chat path already runs via
      // decideTools() (lib/context/tool-decision.ts), reused here rather
      // than duplicated. If the task itself reads as a tool action (e.g.
      // "run the daily report workflow"), the real tool executor runs —
      // respecting requiresApproval/isSimulation exactly as it already does
      // for chat, since both callers share the same toolExecutor.execute().
      //
      // M4-01: the planner generates generic, paraphrased task text (e.g.
      // "Design the automation workflow") that often strips the specific
      // verb/noun combination (e.g. "create a workflow") detectIntent()'s
      // regexes look for — confirmed live: a mission created from "create
      // a workflow for managing WhatsApp" produced a task whose own text
      // never matched the n8n-intent pattern, silently routing tool
      // selection to unrelated placeholder tools instead of
      // n8n.createWorkflow. mission.userRequest carries the user's actual
      // original wording (already stored on every mission — no schema
      // change needed) — appending it gives detectIntent() (regex-based)
      // and the AI tool planner (which also reads this same text) the real
      // request to work from, not just the paraphrase.
      const taskText = `${task.title}. ${task.description}\n\nOriginal user request: ${mission.userRequest}`;
      const toolStep = await trackStep('Tool Decision', async () => {
        const routingIntentStub: Intent = {
          category: 'general',
          confidence: 0.5,
          matchedKeywords: [],
          reason: 'mission-task',
          needsClarification: false,
        };
        const detectedIntent = detectIntent(taskText, routingIntentStub);
        // M5-11: workerId (resolved above via findWorkerForTask, before
        // this point) is who will actually execute the delegated work —
        // this used to always pass managerId here regardless, so a
        // worker's own AGENT_PERMISSIONS scope (M5-10) was never actually
        // checked; tool access for delegated work was gated entirely on
        // the manager's broader permissions (Deep Integrity Audit,
        // Section B).
        return decideTools(taskText, detectedIntent, workerId ?? managerId, mission.tenantId, mission.isSimulation, mission.id, task.id);
      });
      steps.push(toolStep.step);
      const toolResult = toolStep.value;

      // M7-03: make the tri-state tool-decision outcome ('handled' /
      // 'declined_no_match' / 'attempted_failed' — lib/context/tool-decision.ts)
      // explicit and observable here, closing part of the "silent seam"
      // M7-01's own E2E test exposed (a request could be intercepted by
      // this upfront gate with no visible signal for why). Behavior is
      // unchanged by this log line — 'attempted_failed' still throws below
      // (a real tool failure must propagate for a mission task, unlike
      // chat's more lenient degrade-to-loop-then-LLM behavior — see
      // lib/context/context-manager.ts's M7-03 comment for the contrast);
      // 'declined_no_match' still falls through to the agent loop.
      await recordEvent(mission.id, 'tool_decision_outcome', {
        entityType: 'task',
        entityId: task.id,
        title: `Tool decision: ${toolResult.outcome}`,
        detail: toolResult.outcome === 'declined_no_match'
          ? 'No tool category matched — proceeding to agent loop'
          : toolResult.outcome === 'attempted_failed'
            ? 'Tool category matched but did not fully resolve — failing this attempt'
            : 'Tool fully answered the task',
      });

      if (toolResult.shouldUseTool) {
        await recordEvent(mission.id, 'tool_selected', {
          entityType: 'task',
          entityId: task.id,
          title: `Tool selected: ${toolResult.selectedToolIds.join(', ') || 'none'}`,
          detail: `Category matched for: ${task.title}`,
          metadata: { toolIds: toolResult.selectedToolIds },
        });
      }

      let output: string;

      if (toolResult.shouldUseTool && toolResult.success && toolResult.toolAnswer) {
        // Tool fully answered the task — mirrors the chat path's
        // shouldCallLLM:false shortcut (context-manager.ts). No LLM/worker
        // call needed.
        await recordEvent(mission.id, 'workflow_executed', {
          entityType: 'task',
          entityId: task.id,
          title: `Tool execution succeeded: ${toolResult.selectedToolIds.join(', ')}`,
          detail: toolResult.toolAnswer.slice(0, 300),
          metadata: { toolIds: toolResult.selectedToolIds, executions: toolResult.executions.length },
        });
        steps.push({
          step: 'Tool Execution',
          status: 'completed',
          detail: `${toolResult.selectedToolIds.join(', ')} succeeded`,
          durationMs: 0,
        });
        output = toolResult.toolAnswer;
      } else if (toolResult.shouldUseTool && !toolResult.success) {
        // A failed tool call is a failed task, not silently swallowed —
        // unlike the chat path (which degrades to an LLM response), a
        // mission task IS the concrete work item, so a real tool failure
        // must propagate. Throwing here routes it through the exact same
        // retry/backoff/fail loop as any other execution failure below.
        await recordEvent(mission.id, 'workflow_executed', {
          entityType: 'task',
          entityId: task.id,
          title: `Tool execution failed: ${toolResult.selectedToolIds.join(', ')}`,
          detail: toolResult.error ?? 'Unknown tool error',
          metadata: { toolIds: toolResult.selectedToolIds, failed: true },
        });
        throw new Error(toolResult.error || `Tool execution failed for: ${toolResult.selectedToolIds.join(', ')}`);
      } else {
        // No tool action needed — existing LLM/worker execution, unchanged.

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
        let loopSteps: ExecutionStep[] = [];
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
              // M7-01 scope note: the agent loop below only covers direct
              // (non-delegated) manager execution — looping the
              // worker/review pair in manager-delegation.ts is a separate,
              // larger follow-up (that module is also shared with the live
              // chat pipeline, a bigger blast radius than this ticket).
              return executeDelegatedTask(mission, task, managerId, managerName, managerRecord, workerRecord, ctxResult.value, timeoutMs);
            }

            const systemPrompt = ctxResult.value.systemPrompt;

            // Dynamic Model Router: classify this task and let the router pick
            // provider+model instead of always using whatever app_settings has
            // globally configured. Never throws — route() degrades to an empty
            // candidate list on any failure, which chatWithFallback treats
            // exactly like today's un-routed behavior (see resolveOrderedPairs
            // in lib/ai/ai-provider.ts).
            const classification = classifyTask({
              text: taskText,
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

            // M7-01: bounded think->act->observe->repeat loop, replacing
            // what used to be exactly one chatWithFallback() call here.
            // Wrapped in the same withTimeout/timeoutMs this single call
            // used before — now a multi-step budget rather than a
            // single-call one, so a task expected to need several tool
            // steps should raise its task_timeout_ms accordingly (existing
            // per-task column, no new config needed).
            //
            // M7-03: runAgentLoop() was generalized off MissionTask/Mission
            // so the chat pipeline could reuse the same mechanism (see
            // lib/context/context-manager.ts) — this call site now passes
            // the equivalent fields explicitly, plus the checkpoint
            // callbacks wired to mission_tasks.loop_state (only mission
            // tasks get real checkpointing; chat's calls leave these unset).
            const loopResult = await withTimeout(
              runAgentLoop(systemPrompt, ctxResult.value.userPrompt, {
                agentId: managerId,
                tenantId: mission.tenantId,
                isSimulation: mission.isSimulation,
                missionId: mission.id,
                taskId: task.id,
                maxSteps: task.maxLoopSteps,
                initialLoopState: task.loopState,
                onCheckpoint: async (state) => { await updateTask(task.id, { loopState: state }); },
                onClearCheckpoint: async () => { await updateTask(task.id, { loopState: null }); },
              }, {
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

            loopSteps = loopResult.steps;
            return loopResult.output;
          },
        );
        steps.push(llmStep.step);
        steps.push(...loopSteps);
        output = llmStep.value;
      }

      // M5-02: same class of bug as M1-04/M4-01/M4-02 (fake success reported
      // as real), recurring in a new place — Atlas's "Research market trends"
      // task reached status:'completed' with result.output literally being
      // `{"query":"...", "max_results":10, "recency_days":90}`, the tool
      // call's own REQUEST arguments, not an answer (live-confirmed, Deep
      // Integrity Audit Section E). The LLM produced tool-call-shaped JSON
      // instead of prose — a real answer to a research/summary/analysis task
      // is essentially never, in its entirety, a parseable JSON value, so
      // that's what a structural guard checks for, rather than special-casing
      // this one task/tool. Applies to both branches above (tool-answer and
      // LLM output) — a fake success is a fake success regardless of which
      // path produced it. Throwing routes it through the same retry/backoff/
      // fail loop as any other execution failure, never silently accepted.
      if (!looksLikeRealAnswer(output)) {
        throw new Error('Model returned a degenerate result (empty, or raw JSON/tool-call arguments instead of an answer) — treating as a failed attempt.');
      }

      // Success — record completion
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

    // M7-06: roll this task's outcome up into its objective's status —
    // mission_objectives.status was set once at creation and never
    // touched again anywhere in the codebase (the Objectives panel stuck
    // permanently on PENDING). Mirrors the mission-level
    // recalculateProgress() call below, scoped to one objective.
    if (objective) {
      await recalculateObjectiveStatus(mission.id, objective.id);
    }

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

    // M5-05: this used to also call `updateMission(mission.id, { progress })`
    // here, using completedCount/totalCount (ignoring failed tasks) — a
    // different, incorrect formula from recalculateProgress()'s
    // (completed+failed)/total below, which runs immediately after and
    // unconditionally overwrote this write anyway. Removed as dead-weight
    // work using a divergent formula that never actually won; these
    // variables are kept only for the timeline event's narrative detail.
    const completedCount = results.filter((r) => r.status === 'completed').length;
    const totalCount = tasks.length;
    const progress = Math.round(((completedCount) / totalCount) * 100);
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
      : `Model: ${workerRecord.model} (Worker: ${workerRecord.id})`,
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
    `You are ${worker.displayName}, ${worker.role} (id: ${worker.id}). ` +
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

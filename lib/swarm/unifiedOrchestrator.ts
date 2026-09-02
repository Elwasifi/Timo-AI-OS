// Phase 3 + 4 — Unified Orchestrator
//
// The single entry point for all user requests. It uses the Decision Engine
// to classify the request, then routes it through the appropriate pipeline:
//
//   Simple Request  → Crew Coordinator → direct response
//   Mission Request → Mission Engine → Execution Layer → response
//
// No duplicated routing. No duplicated execution. One entry point.
//
// Phase 4 additions:
//   - Records every decision to the runtime activity feed
//   - Updates persistent runtime state (current mission, progress, execution state)
//   - Records timeline events for both simple and mission pipelines
//   - The UI calls orchestrate() — never CrewCoordinator directly

import { makeDecision } from './decisionEngine';
import { launchMission } from './missionEngine';
import { executeMissionTasks } from './executionLayer';
import { updateMission, getTimeline } from './missionService';
import { recordEvent } from './missionTimeline';
import {
  updateRuntimeState,
  emitRuntimeEvent,
  type RuntimeState,
  type ExecutionState,
} from './runtimeStore';
import { route } from '@/lib/ai/router';
import { chatWithFallback } from '@/lib/ai/ai-provider';
import type { OrchestratorResult, PipelineType } from './executionTypes';
import type { Mission } from './types';
import type { RoutingResult, TaskRecord } from '@/types';

// M6-03: the mission pipeline (launchMission + executeMissionTasks) has no
// progress signal until it fully finishes — the user was staring at a bare
// typing indicator the whole time. M3-02 already added a synchronous
// onDecision hook for this, but the acknowledgment text itself was a single
// hardcoded string in the UI layer, identical regardless of what was
// actually asked. This generates a real, fast, request-specific
// acknowledgment instead — routed via the FAST_CHAT profile (high latency
// sensitivity, high cost sensitivity) so it resolves on the quickest
// available provider (usually Groq) well before the mission itself
// finishes, not blocking mission kickoff either way (fire-and-forget below).
const FALLBACK_ACKNOWLEDGMENT = "Got it — this needs a full mission, so I'm breaking it down and getting to work. I'll follow up here with the result.";

export async function generateFastAcknowledgment(userRequest: string, tenantId: string): Promise<string> {
  try {
    const decision = await route({
      classification: {
        taskType: 'FAST_CHAT',
        complexity: 'simple',
        urgency: 'medium',
        expectedContextSize: 'small',
        needsTools: false,
        needsReasoning: false,
        needsStructuredOutput: false,
        needsVision: false,
        latencySensitivity: 'high',
        costSensitivity: 'high',
        reliabilityRequirement: 'normal',
      },
      tenantId,
    });
    const result = await chatWithFallback(
      [{ role: 'user', content: userRequest }],
      {
        systemPrompt: "The user just sent a request that needs real planning and multi-step work — it will take a while. In ONE short, natural sentence, acknowledge specifically what they asked for and say you're getting started on it now. Do not answer the request itself. Do not use quotation marks.",
        temperature: 0.4,
        maxTokens: 60,
        candidates: decision.candidates,
        usageContext: { operation: 'fast_acknowledgment', tenantId },
      },
    );
    return result.content.trim() || FALLBACK_ACKNOWLEDGMENT;
  } catch {
    return FALLBACK_ACKNOWLEDGMENT;
  }
}

export interface OrchestrateOptions {
  announce?: boolean;
  stream?: boolean;
  /** Required — every request is attributed to a tenant (internal or client). */
  tenantId: string;
  /** V1: run as a simulation/R&D mission — no real external side effects, no entitlement consumption. */
  isSimulation?: boolean;
  /** Dynamic Model Router: this turn originated from a voice interaction — biases model selection toward latency (see lib/ai/router/taskClassifier.ts's VOICE profile). */
  isVoice?: boolean;
  /**
   * M3-02: fires synchronously right after the Decision Engine classifies
   * the request, before either pipeline actually runs. The mission
   * pipeline (launchMission + executeMissionTasks) has no other way to
   * signal the caller until the ENTIRE mission finishes — orchestrate()
   * is a single await with no intermediate callback otherwise, unlike the
   * simple pipeline which already streams live progress via
   * CrewCoordinator's onTimeline/onActivity callbacks. Callers use this to
   * show an immediate "received, working on it" acknowledgment for a
   * mission request instead of leaving the user looking at a bare typing
   * indicator for however long the mission takes.
   */
  onDecision?: (pipeline: PipelineType, reason: string) => void;
  /**
   * M6-03: fires once (fire-and-forget, never blocks the pipeline) with a
   * real, request-specific acknowledgment for a mission-pipeline request —
   * generated fast (FAST_CHAT routing profile) so it lands well before the
   * mission itself finishes. Falls back to a static message if the
   * acknowledgment call itself fails; never left unfired.
   */
  onAcknowledgment?: (text: string) => void;
}

export interface OrchestrateResult extends OrchestratorResult {
  routing?: RoutingResult;
  task?: TaskRecord;
}

// ---- Simple Pipeline (delegates to CrewCoordinator) ----

async function runSimplePipeline(
  userRequest: string,
  options: OrchestrateOptions,
): Promise<{
  response: string;
  timeline: OrchestratorResult['timeline'];
  routing?: RoutingResult;
  task?: TaskRecord;
}> {
  const { crewCoordinator } = await import('@/lib/crew/crew-coordinator');

  try {
    const result = await crewCoordinator.routeAndRespond(userRequest, {
      announce: options.announce ?? true,
      stream: options.stream ?? false,
      isSimulation: options.isSimulation ?? false,
      isVoice: options.isVoice ?? false,
    });
    return {
      response: result.response,
      timeline: null,
      routing: result.routing,
      task: result.task,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simple pipeline failed';
    return {
      response: `I encountered an issue processing your request: ${message}`,
      timeline: null,
    };
  }
}

// ---- Mission Pipeline ----

async function runMissionPipeline(
  userRequest: string,
  tenantId: string,
  isSimulation: boolean,
): Promise<{
  response: string;
  missionId: string | null;
  execution: OrchestratorResult['execution'];
  timeline: OrchestratorResult['timeline'];
}> {
  // Emit planning event — Temo is planning the mission
  await emitRuntimeEvent({
    eventType: 'planning',
    agentId: 'temo',
    workerId: null,
    missionId: null,
    taskId: null,
    timestamp: new Date().toISOString(),
    status: 'completed',
    title: 'Planning mission',
    detail: `Decomposing request into objectives and tasks`,
  });

  // 1. Launch the mission (creates mission, objectives, tasks, dispatches)
  const missionResult = await launchMission({ userRequest, tenantId, isSimulation });

  if (!missionResult) {
    return {
      response: 'I was unable to start a mission for this request. Please try rephrasing.',
      missionId: null,
      execution: null,
      timeline: null,
    };
  }

  if ('code' in missionResult) {
    return {
      response: `I can't start this mission: ${missionResult.reason}`,
      missionId: null,
      execution: null,
      timeline: null,
    };
  }

  // 2. Execute all dispatched tasks
  const { mission, objectives, tasks } = missionResult;

  await recordEvent(mission.id, 'pipeline_selected', {
    entityType: 'mission',
    entityId: mission.id,
    title: 'Mission pipeline selected',
    detail: `Executing ${tasks.length} tasks across ${objectives.length} objectives`,
  });

  await updateRuntimeState({
    currentMissionId: mission.id,
    executionState: 'executing',
    runningTaskIds: tasks.map((t) => t.id),
    missionProgress: 0,
  });

  const executionResults = await executeMissionTasks(mission, tasks, objectives);

  // 3. Determine final mission status
  const completed = executionResults.filter((r) => r.status === 'completed');
  const failed = executionResults.filter((r) => r.status === 'failed');
  const allDone = completed.length + failed.length === tasks.length;

  let finalStatus = mission.status;
  if (allDone) {
    finalStatus = failed.length === 0 ? 'completed' : (completed.length > 0 ? 'completed' : 'failed');
    await updateMission(mission.id, {
      status: finalStatus,
      progress: 100,
    });
  }

  // 4. Fetch final timeline
  const timeline = await getTimeline(mission.id);

  // 5. Update runtime state
  // M5-03: pass this mission's own id as the optimistic-lock precondition
  // — if a different mission has since claimed the "current" slot, this
  // stale write is a no-op rather than clobbering the newer mission's
  // live state with this mission's final numbers.
  const execState: ExecutionState = failed.length === 0 ? 'completed' : 'failed';
  await updateRuntimeState({
    currentMissionId: mission.id,
    executionState: execState,
    runningTaskIds: [],
    missionProgress: 100,
  }, mission.id);

  // 6. Build the synthesized response from execution results
  const response = buildMissionResponse(mission, executionResults, failed.length > 0);

  return {
    response,
    missionId: mission.id,
    execution: executionResults,
    timeline,
  };
}

// ---- Response Synthesis ----

function buildMissionResponse(
  mission: Mission,
  results: OrchestratorResult['execution'],
  hasFailures: boolean,
): string {
  if (!results || results.length === 0) {
    return `Mission "${mission.title}" was created but no tasks were executed.`;
  }

  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status === 'failed');

  // Temo returns only the final synthesized result — the last completed
  // task's output. Earlier task outputs were already threaded into the
  // review/synthesis step via priorResults, so they are incorporated into
  // the final output and should not be repeated.
  const finalResult = completed[completed.length - 1];

  const sections: string[] = [];

  sections.push(`## Mission: ${mission.title}`);
  sections.push(`**Objective:** ${mission.objective}`);
  sections.push(`**Complexity:** ${mission.estimatedComplexity} | **Priority:** ${mission.priority}`);
  sections.push('');

  if (finalResult) {
    sections.push(finalResult.output);
  } else {
    sections.push('No tasks completed successfully.');
  }

  sections.push('');

  if (failed.length > 0) {
    sections.push(`### Failed Tasks (${failed.length})`);
    for (const r of failed) {
      sections.push(`- ${r.managerName}: ${r.error}`);
    }
    sections.push('');
  }

  if (hasFailures) {
    sections.push('---');
    sections.push('Some tasks could not be completed. The mission completed with partial results.');
  }

  return sections.join('\n');
}

// ---- Main Entry Point ----

export async function orchestrate(
  userRequest: string,
  options: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const startTime = Date.now();
  const opts: OrchestrateOptions = {
    announce: options.announce ?? true,
    stream: options.stream ?? false,
    tenantId: options.tenantId,
    isSimulation: options.isSimulation ?? false,
  };

  // 1. Decision Engine: classify the request
  const decision = makeDecision(userRequest);
  const now0 = new Date().toISOString();

  // M3-02: notify the caller which pipeline was picked before running it —
  // see OrchestrateOptions.onDecision for why this exists.
  options.onDecision?.(decision.pipeline, decision.reason);

  // M6-03: kick off the fast acknowledgment in parallel with everything
  // below — never awaited here, so it can never delay mission kickoff or
  // the final response.
  if (decision.pipeline === 'mission' && options.onAcknowledgment) {
    const onAck = options.onAcknowledgment;
    generateFastAcknowledgment(userRequest, options.tenantId).then(onAck);
  }

  // 2. Emit thinking event — Temo is analyzing the request
  await emitRuntimeEvent({
    eventType: 'thinking',
    agentId: 'temo',
    workerId: null,
    missionId: null,
    taskId: null,
    timestamp: now0,
    status: 'completed',
    title: 'Analyzing request',
    detail: decision.reason,
    metadata: {
      pipeline: decision.pipeline,
      confidence: decision.confidence,
      signals: decision.signals,
      complexity: decision.estimatedComplexity,
    },
  });

  // 3. Emit routing event — decision made, routing to pipeline
  await emitRuntimeEvent({
    eventType: 'routing',
    agentId: 'temo',
    workerId: null,
    missionId: null,
    taskId: null,
    timestamp: new Date().toISOString(),
    status: 'completed',
    title: `Routed to ${decision.pipeline} pipeline`,
    detail: decision.reason,
    metadata: {
      pipeline: decision.pipeline,
      confidence: decision.confidence,
    },
  });

  // 4. Update runtime state to routing
  await updateRuntimeState({
    executionState: 'routing',
  });

  // 4. Route to the appropriate pipeline
  let response: string;
  let missionId: string | null = null;
  let execution: OrchestratorResult['execution'] = null;
  let timeline: OrchestratorResult['timeline'] = null;
  let routing: RoutingResult | undefined;
  let task: TaskRecord | undefined;

  if (decision.pipeline === 'simple') {
    const result = await runSimplePipeline(userRequest, opts);
    response = result.response;
    timeline = result.timeline;
    routing = result.routing;
    task = result.task;

    await updateRuntimeState({ executionState: 'completed' });

    // Emit synthesizing event — Temo is composing the final response
    await emitRuntimeEvent({
      eventType: 'synthesizing',
      agentId: routing?.selectedAgentId ?? 'temo',
      workerId: null,
      missionId: null,
      taskId: task?.id ?? null,
      timestamp: new Date().toISOString(),
      status: 'completed',
      title: 'Response synthesized (simple pipeline)',
      detail: response.slice(0, 200),
    });

    // Emit speaking event — agent is delivering the response
    await emitRuntimeEvent({
      eventType: 'speaking',
      agentId: routing?.selectedAgentId ?? 'temo',
      workerId: null,
      missionId: null,
      taskId: task?.id ?? null,
      timestamp: new Date().toISOString(),
      status: 'completed',
      title: 'Response delivered',
      detail: response.slice(0, 200),
    });

    // Emit completed event
    await emitRuntimeEvent({
      eventType: 'completed',
      agentId: routing?.selectedAgentId ?? 'temo',
      workerId: null,
      missionId: null,
      taskId: task?.id ?? null,
      timestamp: new Date().toISOString(),
      status: 'completed',
      title: 'Request completed (simple pipeline)',
      detail: `Duration: ${Date.now() - startTime}ms`,
      metadata: { durationMs: Date.now() - startTime },
    });
  } else {
    let missionFailed = false;
    try {
      const result = await runMissionPipeline(userRequest, opts.tenantId, opts.isSimulation ?? false);
      response = result.response;
      missionId = result.missionId;
      execution = result.execution;
      timeline = result.timeline;

      // Emit synthesizing event — building response from mission results
      await emitRuntimeEvent({
        eventType: 'synthesizing',
        agentId: 'temo',
        workerId: null,
        missionId,
        taskId: null,
        timestamp: new Date().toISOString(),
        status: 'completed',
        title: 'Response synthesized (mission pipeline)',
        detail: `Mission ${missionId ?? 'unknown'} results aggregated`,
      });

      // Emit speaking event — Temo is delivering the response
      await emitRuntimeEvent({
        eventType: 'speaking',
        agentId: 'temo',
        workerId: null,
        missionId,
        taskId: null,
        timestamp: new Date().toISOString(),
        status: 'completed',
        title: 'Response delivered',
        detail: response.slice(0, 200),
      });

      // Emit completed event
      await emitRuntimeEvent({
        eventType: 'completed',
        agentId: 'temo',
        workerId: null,
        missionId,
        taskId: null,
        timestamp: new Date().toISOString(),
        status: 'completed',
        title: 'Mission completed',
        detail: `Mission ${missionId ?? 'unknown'} completed`,
        metadata: { durationMs: Date.now() - startTime },
      });
    } catch (err) {
      missionFailed = true;
      const message = err instanceof Error ? err.message : 'Mission pipeline failed';
      response = `I encountered an issue processing your mission: ${message}`;

      // Emit failed event
      await emitRuntimeEvent({
        eventType: 'failed',
        agentId: 'temo',
        workerId: null,
        missionId,
        taskId: null,
        timestamp: new Date().toISOString(),
        status: 'failed',
        title: 'Mission failed',
        detail: message,
        metadata: { error: message },
      });
    }
    void missionFailed;
  }

  return {
    decision,
    pipeline: decision.pipeline,
    response,
    missionId,
    execution,
    timeline,
    durationMs: Date.now() - startTime,
    routing,
    task,
  };
}

// ---- Runtime State Accessor (for UI) ----

export async function getRuntimeState(): Promise<RuntimeState> {
  const { getRuntimeState: getState } = await import('./runtimeStore');
  return getState();
}

// Generalized Manager → Worker Delegation — Level 3
//
// Registry-driven delegation mechanism usable by ANY manager with active
// worker children in the agent registry. No manager or worker identity is
// hardcoded: a manager's workers are found via parentId, and the worker is
// selected by scoring its own `capabilities` (from the registry) against
// the request text. This generalizes the pattern first proven for Nova
// (see nova-delegation.ts, now a thin wrapper around this module).
//
// If a manager has no registered active workers, or no worker's
// capabilities match the request, delegation is skipped — this module
// never fabricates a worker. The caller falls back to direct manager
// execution, exactly as the Nova pilot did.
//
// Communication chain: TEMO → MANAGER → WORKER → MANAGER → TEMO
// Workers never communicate directly with Temo.

import { chatWithFallback, type ChatMessage } from '@/lib/ai/ai-provider';
import { route, classifyTask, type RoutingDecision } from '@/lib/ai/router';
import { loadSettings } from '@/lib/settings/settings-service';
import { logger } from '@/lib/utils/logger';
import { emitRuntimeEvent } from '@/lib/swarm/runtimeStore';
import { loadAgents, getAgentById } from '@/lib/agents/agentRegistryService';
import { useAuthStore } from '@/stores/authStore';
import type { AgentRecord } from '@/lib/agents/types';
import type { Agent, ActivityFeedItem, TimelineEvent } from '@/types';

// ---- Structured Task (Manager → Worker) ----

export interface WorkerTask {
  taskId: string;
  originalObjective: string;
  delegatedTask: string;
  context: string;
  parentManagerId: string;
  requiredCapabilities: string[];
  acceptanceCriteria: string[];
  /** Set when this delegation happens inside Mission execution, so routing decisions attribute correctly in usage_ledger/mission_timeline. Undefined for chat-path delegation, which has no mission. */
  missionId?: string | null;
}

// ---- Structured Result (Worker → Manager) ----

export interface WorkerResult {
  workerId: string;
  taskId: string;
  status: 'completed' | 'failed' | 'timeout';
  result: string;
  summary: string;
  errors: string[];
  metadata: Record<string, unknown>;
}

// ---- Callbacks (bridge to orchestration store) ----

export interface DelegationCallbacks {
  onTimeline?: (
    taskId: string,
    label: string,
    detail: string,
    status?: TimelineEvent['status'],
  ) => void;
  onActivity?: (item: Omit<ActivityFeedItem, 'id' | 'timestamp'>) => void;
  onAgentStatus?: (agentId: string, status: Agent['status'], activity?: string) => void;
  onWorkerActive?: (workerId: string | null) => void;
}

export interface DelegationResult {
  response: string;
  delegated: boolean;
  workerId?: string;
}

// ---- Registry-Driven Worker Selection ----
//
// Finds `managerId`'s active worker children (parentId match, level ===
// 'worker', isActive) and scores each by how many of its own registered
// `capabilities` appear as keywords in the request text. This mirrors the
// Nova pilot's keyword approach, but the keywords come from the registry
// instead of a hardcoded per-worker table — any manager/worker pair
// defined in agent_registry works without code changes.

export async function selectWorkerForManager(
  managerId: string,
  input: string,
): Promise<AgentRecord | null> {
  const agents = await loadAgents();
  const workers = agents.filter(
    (a) => a.level === 'worker' && a.isActive && a.parentId === managerId,
  );
  if (workers.length === 0) return null;

  const lower = input.toLowerCase();
  let best: AgentRecord | null = null;
  let bestScore = 0;

  for (const worker of workers) {
    let score = 0;
    for (const capability of worker.capabilities) {
      const keyword = capability.replace(/_/g, ' ').trim().toLowerCase();
      if (keyword && lower.includes(keyword)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = worker;
    }
  }

  return bestScore > 0 ? best : null;
}

// ---- Worker Execution ----
//
// Shared, context-agnostic core: both the chat pipeline (delegateManagerTask,
// below) and the Mission pipeline (lib/swarm/executionLayer.ts) call this
// directly, so there is exactly one place that classifies a delegated turn
// as AGENT_TO_AGENT and routes it — no duplicate delegation logic. Each
// caller supplies its own tenantId (chat reads it from useAuthStore;
// Mission execution has it on the mission record) and its own side-effect
// bridge: chat passes DelegationCallbacks for live UI state, Mission
// execution passes none and instead persists via lib/swarm/missionTimeline.ts
// after inspecting the returned decision.

export async function executeWorker(
  task: WorkerTask,
  worker: AgentRecord,
  tenantId: string | null,
  callbacks: DelegationCallbacks = {},
  systemPromptOverride?: string,
): Promise<{ result: WorkerResult; decision: RoutingDecision }> {
  const settings = await loadSettings();

  const systemPrompt =
    systemPromptOverride ??
    (`You are ${worker.displayName}, ${worker.role} (id: ${worker.id}). ` +
      `You are executing a task delegated by your department manager. ` +
      `Your capabilities: ${worker.capabilities.join(', ')}. ` +
      'Provide concrete, implementation-ready solutions. Always include code examples ' +
      'when relevant.');

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `## Delegated Task\n${task.delegatedTask}\n\n` +
        `## Original Objective\n${task.originalObjective}\n\n` +
        `## Context\n${task.context || 'No additional context provided.'}\n\n` +
        `## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\n` +
        'Provide a complete solution. Include code examples where relevant.',
    },
  ];

  callbacks.onTimeline?.(task.taskId, 'Worker processing', `${worker.displayName} is executing...`, 'active');
  callbacks.onActivity?.({
    type: 'task',
    title: `${worker.displayName} executing`,
    detail: task.delegatedTask.slice(0, 60),
    agentId: worker.id,
    agentColor: worker.themeColor,
  });

  // Manager→Worker delegation is internal agent-to-agent coordination,
  // not a user-facing chat turn — the router's AGENT_TO_AGENT profile
  // prioritizes low latency and reliable output over always reaching for
  // the strongest (slowest, priciest) model (mission Section 13).
  const classification = classifyTask({ text: task.delegatedTask, isAgentToAgent: true });
  const decision = await route({ classification, tenantId });

  try {
    const result = await chatWithFallback(messages, {
      systemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.max_tokens,
      candidates: decision.candidates,
      usageContext: {
        operation: 'worker_execution',
        missionId: task.missionId ?? null,
        taskId: task.taskId,
        agentId: worker.id,
        managerId: task.parentManagerId,
        tenantId,
        metadata: { taskType: decision.taskType, routingMode: decision.mode },
      },
    });

    return {
      decision,
      result: {
        workerId: worker.id,
        taskId: task.taskId,
        status: 'completed',
        result: result.content,
        summary: result.content.slice(0, 200),
        errors: [],
        metadata: {},
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker execution failed';
    logger.error(`Worker ${worker.id} failed: ${message}`);
    return {
      decision,
      result: {
        workerId: worker.id,
        taskId: task.taskId,
        status: 'failed',
        result: '',
        summary: '',
        errors: [message],
        metadata: {},
      },
    };
  }
}

// ---- Manager Review / Aggregation ----

export async function managerReview(
  manager: AgentRecord,
  workerResult: WorkerResult,
  originalInput: string,
  context: string,
  tenantId: string | null,
  missionId?: string | null,
  taskId?: string | null,
): Promise<{ content: string; decision: RoutingDecision }> {
  const settings = await loadSettings();

  const systemPrompt =
    `You are ${manager.displayName}, ${manager.role}. One of your workers has completed a task. ` +
    'Review their work for accuracy, completeness, and quality. Provide a final, polished ' +
    'response to the user that incorporates the worker\'s solution. If the worker\'s ' +
    'solution is good, present it clearly. If it needs corrections, fix them. The response ' +
    'should be natural and helpful, as if you are speaking directly to the user.';

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `## Original User Request\n${originalInput}\n\n` +
        `## Context\n${context || 'No additional context.'}\n\n` +
        `## Worker Result (${workerResult.workerId})\n${workerResult.result}\n\n` +
        'Review this result and provide the final response to the user:',
    },
  ];

  const classification = classifyTask({ text: originalInput, isAgentToAgent: true });
  const decision = await route({ classification, tenantId });

  const result = await chatWithFallback(messages, {
    systemPrompt,
    temperature: settings.temperature,
    maxTokens: settings.max_tokens,
    candidates: decision.candidates,
    usageContext: {
      operation: 'manager_review',
      missionId: missionId ?? null,
      taskId: taskId ?? null,
      agentId: manager.id,
      tenantId,
      metadata: { taskType: decision.taskType, routingMode: decision.mode },
    },
  });

  return { content: result.content, decision };
}

// ---- Main Delegation Entry Point ----
//
// Generic replacement for the Nova pilot's delegateToWorker(). Works for
// any managerId that has active worker children registered in the agent
// registry. Returns { delegated: false } — never a fabricated result —
// when the manager is unknown, has no active workers, or no worker's
// capabilities match the request; the caller then falls back to direct
// manager execution.

export async function delegateManagerTask(
  managerId: string,
  input: string,
  context: string,
  taskId: string,
  callbacks: DelegationCallbacks,
): Promise<DelegationResult> {
  // 1. Identify the manager
  const manager = await getAgentById(managerId);
  if (!manager) {
    return { response: '', delegated: false };
  }

  // 2. Select a worker from the manager's registered children based on
  //    capability overlap with the request (registry-driven, no fake
  //    worker is ever synthesized).
  const worker = await selectWorkerForManager(managerId, input);
  if (!worker) {
    return { response: '', delegated: false };
  }

  logger.routing(`${manager.displayName} delegating to ${worker.displayName} (${worker.id})`);

  const tenantId = useAuthStore.getState().currentTenantId;

  // 3. Emit "delegated" event
  callbacks.onTimeline?.(taskId, 'Delegated', `${manager.displayName} → ${worker.displayName}`, 'completed');
  callbacks.onActivity?.({
    type: 'routing',
    title: `${manager.displayName} delegated to ${worker.displayName}`,
    detail: input.slice(0, 60),
    agentId: manager.id,
    agentColor: manager.themeColor,
  });

  await emitRuntimeEvent({
    eventType: 'routing',
    agentId: manager.id,
    workerId: worker.id,
    missionId: null,
    taskId,
    timestamp: new Date().toISOString(),
    status: 'completed',
    title: `${manager.displayName} delegated to ${worker.displayName}`,
    detail: input.slice(0, 200),
  });

  // 4. Construct structured worker task
  const task: WorkerTask = {
    taskId,
    originalObjective: input,
    delegatedTask: input,
    context,
    parentManagerId: manager.id,
    requiredCapabilities: worker.capabilities,
    acceptanceCriteria: [
      'Solution addresses the original objective',
      'Code examples are syntactically correct',
      'Response is clear and actionable',
    ],
  };

  // 5. Emit "worker_started" and set active worker
  callbacks.onTimeline?.(taskId, 'Worker started', `${worker.displayName} assigned`, 'active');
  callbacks.onAgentStatus?.(worker.id, 'thinking', 'Processing delegated task');
  callbacks.onWorkerActive?.(worker.id);

  await emitRuntimeEvent({
    eventType: 'executing',
    agentId: manager.id,
    workerId: worker.id,
    missionId: null,
    taskId,
    timestamp: new Date().toISOString(),
    status: 'active',
    title: `${worker.displayName} executing`,
    detail: task.delegatedTask.slice(0, 200),
  });

  // 6. Execute worker
  const { result: workerResult } = await executeWorker(task, worker, tenantId, callbacks);

  // 7. Handle failure → emit "worker_failed" and fall back
  if (workerResult.status === 'failed') {
    callbacks.onTimeline?.(
      taskId,
      'Worker failed',
      workerResult.errors.join('; ') || 'Unknown error',
      'error',
    );
    callbacks.onActivity?.({
      type: 'error',
      title: `${worker.displayName} failed`,
      detail: `Falling back to direct ${manager.displayName} execution`,
      agentId: manager.id,
      agentColor: manager.themeColor,
    });
    callbacks.onAgentStatus?.(worker.id, 'offline', 'Worker failed');
    callbacks.onWorkerActive?.(null);

    await emitRuntimeEvent({
      eventType: 'failed',
      agentId: manager.id,
      workerId: worker.id,
      missionId: null,
      taskId,
      timestamp: new Date().toISOString(),
      status: 'failed',
      title: `${worker.displayName} failed`,
      detail: workerResult.errors.join('; ') || 'Unknown error',
    });

    return { response: '', delegated: false };
  }

  // 8. Emit "worker_completed"
  callbacks.onTimeline?.(
    taskId,
    'Worker completed',
    `${worker.displayName} returned result`,
    'completed',
  );
  callbacks.onAgentStatus?.(worker.id, 'available', 'Worker completed');

  await emitRuntimeEvent({
    eventType: 'completed',
    agentId: manager.id,
    workerId: worker.id,
    missionId: null,
    taskId,
    timestamp: new Date().toISOString(),
    status: 'completed',
    title: `${worker.displayName} completed`,
    detail: workerResult.summary.slice(0, 200),
  });

  // 9. Emit "manager_reviewing" and review the result
  callbacks.onTimeline?.(taskId, 'Manager reviewing', `${manager.displayName} reviewing worker result...`, 'active');
  callbacks.onAgentStatus?.(manager.id, 'thinking', 'Reviewing worker result');
  callbacks.onWorkerActive?.(null);

  await emitRuntimeEvent({
    eventType: 'reviewing',
    agentId: manager.id,
    workerId: worker.id,
    missionId: null,
    taskId,
    timestamp: new Date().toISOString(),
    status: 'active',
    title: `${manager.displayName} reviewing worker result`,
    detail: `Reviewing output from ${worker.displayName}`,
  });

  try {
    const { content: reviewedResponse } = await managerReview(manager, workerResult, input, context, tenantId, null, taskId);

    // 10. Emit "manager_completed"
    callbacks.onTimeline?.(taskId, 'Manager completed', `${manager.displayName} review complete`, 'completed');
    callbacks.onActivity?.({
      type: 'task',
      title: `${manager.displayName} review complete`,
      detail: `Delegated to ${worker.displayName}, reviewed and aggregated`,
      agentId: manager.id,
      agentColor: manager.themeColor,
    });

    await emitRuntimeEvent({
      eventType: 'completed',
      agentId: manager.id,
      workerId: null,
      missionId: null,
      taskId,
      timestamp: new Date().toISOString(),
      status: 'completed',
      title: `${manager.displayName} review complete`,
      detail: `Delegated to ${worker.displayName}, reviewed and aggregated`,
    });

    return { response: reviewedResponse, delegated: true, workerId: worker.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Manager review failed';
    logger.error(`${manager.displayName} review failed: ${message}`);
    callbacks.onTimeline?.(taskId, 'Review failed', message, 'error');

    await emitRuntimeEvent({
      eventType: 'failed',
      agentId: manager.id,
      workerId: worker.id,
      missionId: null,
      taskId,
      timestamp: new Date().toISOString(),
      status: 'failed',
      title: `${manager.displayName} review failed`,
      detail: message,
    });

    // If review fails but the worker produced a result, use it as fallback
    if (workerResult.result) {
      return { response: workerResult.result, delegated: true, workerId: worker.id };
    }
    return { response: '', delegated: false };
  }
}

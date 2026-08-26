import type { RoutingResult, TaskExecution, TimelineEvent, TaskStatus } from '@/types';

/**
 * TaskDispatcher — takes a RoutingResult and creates a TaskExecution object
 * with the agent's workflow metadata. No real n8n execution happens yet —
 * this is architecture preparation.
 */
export class TaskDispatcher {
  /**
   * Build a TaskExecution from a routing result and the agent's workflow config.
   */
  dispatch(routing: RoutingResult, agentWorkflow: { workflowId: string; workflowEndpoint: string }): TaskExecution {
    return {
      taskId: routing.taskId,
      agentId: routing.selectedAgentId,
      workflowId: agentWorkflow.workflowId,
      workflowEndpoint: agentWorkflow.workflowEndpoint,
      status: 'pending',
      payload: {
        input: routing.input,
        intent: routing.intent.category,
        confidence: routing.confidence,
        matchedKeywords: routing.intent.matchedKeywords,
      },
      createdAt: Date.now(),
    };
  }

  /**
   * Mark an execution as executing (simulated).
   */
  start(execution: TaskExecution): TaskExecution {
    return { ...execution, status: 'executing' };
  }

  /**
   * Mark an execution as completed.
   */
  complete(execution: TaskExecution): TaskExecution {
    return { ...execution, status: 'completed' };
  }
}

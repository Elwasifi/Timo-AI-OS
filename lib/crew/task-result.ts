import type { TaskRecord, TimelineEvent, TaskStatus, Intent, RoutingResult, TaskExecution } from '@/types';

/**
 * TaskResult — builds and updates TaskRecord objects.
 * A TaskRecord is the full history of a routed task: input, chosen agent,
 * reason, confidence, timeline, result, duration, and execution object.
 */
export class TaskResult {
  /**
   * Create a new TaskRecord from a routing result and execution.
   */
  create(routing: RoutingResult, execution: TaskExecution, agentColor: string): TaskRecord {
    return {
      id: routing.taskId,
      input: routing.input,
      agentId: routing.selectedAgentId,
      agentName: routing.selectedAgentName,
      agentColor,
      reason: routing.reason,
      confidence: routing.confidence,
      status: 'received',
      intent: routing.intent,
      timeline: [],
      result: '',
      duration: 0,
      createdAt: Date.now(),
      completedAt: null,
      execution,
    };
  }

  /**
   * Add a timeline event to a task record.
   */
  addTimelineEvent(task: TaskRecord, label: string, detail: string, status: TimelineEvent['status'] = 'completed'): TaskRecord {
    const event: TimelineEvent = {
      id: `tl-${task.id}-${task.timeline.length}`,
      taskId: task.id,
      label,
      detail,
      status,
      timestamp: Date.now(),
      order: task.timeline.length,
    };
    return { ...task, timeline: [...task.timeline, event] };
  }

  /**
   * Update the status of a task record.
   */
  setStatus(task: TaskRecord, status: TaskStatus): TaskRecord {
    return { ...task, status };
  }

  /**
   * Finalize a task with its result text and computed duration.
   */
  complete(task: TaskRecord, result: string): TaskRecord {
    return {
      ...task,
      status: 'completed',
      result,
      completedAt: Date.now(),
      duration: Date.now() - task.createdAt,
      execution: { ...task.execution, status: 'completed' },
    };
  }
}

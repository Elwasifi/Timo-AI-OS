// M7-13c-2b-2b — the pure part of the mission SSE stream (app/api/stream/mission/route.ts): which timeline events END
// the stream, and how a timeline event maps to a stream event. Kept pure so it is unit-testable. A stream that does
// not recognise a settle event keeps polling for the full 5 minutes, so every settle event MUST be listed here.

import type { StreamEvent } from '@/lib/api/realtime';

/** The timeline events that mean "this mission is settled" — the stream sends its closing event and ends on any of them. */
export const SETTLE_TIMELINE_EVENTS: readonly string[] = ['mission_completed', 'mission_failed', 'mission_partial'];

/** The outcome carried on the closing event, or null while no settle event exists yet. */
export function settledOutcomeOf(timeline: ReadonlyArray<{ eventType: string }>): 'completed' | 'failed' | 'partial' | null {
  const hit = timeline.find((t) => SETTLE_TIMELINE_EVENTS.includes(t.eventType));
  if (!hit) return null;
  return hit.eventType === 'mission_failed' ? 'failed' : hit.eventType === 'mission_partial' ? 'partial' : 'completed';
}

export function mapTimelineEventToStreamEvent(timelineEventType: string): StreamEvent {
  const map: Record<string, StreamEvent> = {
    mission_created: 'mission_started',
    mission_planned: 'mission_started',
    objectives_generated: 'mission_started',
    tasks_created: 'task_started',
    task_assigned: 'manager_assigned',
    task_started: 'task_started',
    task_completed: 'task_finished',
    task_failed: 'mission_failed',
    task_skipped: 'task_finished',
    tool_selected: 'tool_executed',
    workflow_executed: 'workflow_executed',
    memory_retrieved: 'memory_loaded',
    knowledge_retrieved: 'knowledge_retrieved',
    provider_selected: 'provider_selected',
    execution_started: 'task_started',
    execution_finished: 'task_finished',
    execution_failed: 'mission_failed',
    execution_retried: 'task_started',
    mission_completed: 'mission_completed',
    mission_failed: 'mission_failed',
    mission_partial: 'mission_partial',
    decision_made: 'decision_made',
    pipeline_selected: 'mission_started',
    mission_updated: 'mission_progress',
  };
  return map[timelineEventType] ?? 'mission_progress';
}

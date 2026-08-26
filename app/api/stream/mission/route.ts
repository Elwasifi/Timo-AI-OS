import { NextRequest } from 'next/server';
import { getTimeline } from '@/lib/swarm/missionService';
import { formatSSE, type StreamEvent } from '@/lib/api/realtime';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE streaming endpoint for mission execution events.
//
// The v0 UI connects to this endpoint to receive a live stream of
// timeline events for a specific mission. It polls the timeline table
// at a short interval and emits new events as SSE.
//
// This does NOT redesign execution — it only exposes existing timeline
// events as a stream.

const POLL_INTERVAL_MS = 1500;
const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes max

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Sign in required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const missionId = url.searchParams.get('missionId');

  if (!missionId) {
    return new Response(
      JSON.stringify({ error: 'missionId query parameter required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  let lastEventIndex = 0;
  const startTime = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(formatSSE('mission_started' as StreamEvent, { missionId, connected: true })));

      const poll = async () => {
        try {
          if (Date.now() - startTime > MAX_DURATION_MS) {
            controller.enqueue(encoder.encode(formatSSE('mission_completed' as StreamEvent, { missionId, reason: 'timeout' })));
            controller.close();
            return;
          }

          const timeline = await getTimeline(missionId);

          // Send only new events
          if (timeline.length > lastEventIndex) {
            for (let i = lastEventIndex; i < timeline.length; i++) {
              const entry = timeline[i];
              const event = mapTimelineEventToStreamEvent(entry.eventType);
              controller.enqueue(encoder.encode(formatSSE(event, {
                missionId,
                timelineId: entry.id,
                eventType: entry.eventType,
                title: entry.title,
                detail: entry.detail,
                metadata: entry.metadata,
                timestamp: entry.createdAt,
              })));
            }
            lastEventIndex = timeline.length;
          }

          // Check if mission is complete
          const hasCompleted = timeline.some(
            (t) => t.eventType === 'mission_completed' || t.eventType === 'mission_failed',
          );
          if (hasCompleted) {
            controller.enqueue(encoder.encode(formatSSE('mission_completed' as StreamEvent, { missionId, finalEventCount: timeline.length })));
            controller.close();
            return;
          }

          setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
          // Continue polling on error
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      setTimeout(poll, POLL_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function mapTimelineEventToStreamEvent(timelineEventType: string): StreamEvent {
  const map: Record<string, StreamEvent> = {
    mission_created: 'mission_started',
    mission_planned: 'mission_started',
    objectives_generated: 'mission_started',
    tasks_created: 'task_started',
    task_assigned: 'manager_assigned',
    task_started: 'task_started',
    task_completed: 'task_finished',
    task_failed: 'mission_failed',
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
    decision_made: 'decision_made',
    pipeline_selected: 'mission_started',
    mission_updated: 'mission_progress',
  };
  return map[timelineEventType] ?? 'mission_progress';
}

import { NextRequest } from 'next/server';
import { getRuntimeActivity } from '@/lib/swarm/runtimeStore';
import { getRuntimeState } from '@/lib/swarm/runtimeStore';
import { formatSSE, type StreamEvent } from '@/lib/api/realtime';
import { requireUser } from '@/lib/auth/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE endpoint for realtime runtime updates.
//
// Streams runtime state changes and new activity feed entries.
// The v0 UI connects here for live dashboard updates without polling.

const POLL_INTERVAL_MS = 2000;
const MAX_DURATION_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Sign in required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let lastActivityCount = 0;
  let lastStateHash = '';
  const startTime = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(formatSSE('mission_started' as StreamEvent, { realtime: true, connected: true })));

      const poll = async () => {
        try {
          if (Date.now() - startTime > MAX_DURATION_MS) {
            controller.close();
            return;
          }

          const [activity, state] = await Promise.all([
            getRuntimeActivity(30),
            getRuntimeState(),
          ]);

          // New activity items
          if (activity.length > lastActivityCount && lastActivityCount > 0) {
            const newItems = activity.slice(0, activity.length - lastActivityCount);
            for (const item of newItems) {
              controller.enqueue(encoder.encode(formatSSE('decision_made' as StreamEvent, {
                eventType: item.eventType,
                title: item.title,
                detail: item.detail,
                agentId: item.agentId,
                workerId: item.workerId,
                missionId: item.missionId,
                taskId: item.taskId,
                status: item.status,
                timestamp: item.createdAt,
              })));
            }
          }
          lastActivityCount = activity.length;

          // State changed
          const stateHash = `${state.executionState}:${state.currentMissionId}:${state.missionProgress}`;
          if (stateHash !== lastStateHash) {
            controller.enqueue(encoder.encode(formatSSE('mission_progress' as StreamEvent, {
              executionState: state.executionState,
              currentMissionId: state.currentMissionId,
              missionProgress: state.missionProgress,
              currentManagerId: state.currentManagerId,
              runningTaskIds: state.runningTaskIds,
            })));
            lastStateHash = stateHash;
          }

          setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
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

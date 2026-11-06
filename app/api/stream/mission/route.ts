import { NextRequest } from 'next/server';
import { getMission, getTimeline } from '@/lib/swarm/missionService';
import { formatSSE, type StreamEvent } from '@/lib/api/realtime';
import { requireUser, isTenantMember } from '@/lib/auth/apiAuth';
import { mapTimelineEventToStreamEvent, settledOutcomeOf } from '@/lib/swarm/missionStreamEvents';

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

  // M1-06: this route's missionService.ts client is service-role
  // server-side (RLS is not a backstop) — without this check, any
  // authenticated user could stream any tenant's mission timeline for up
  // to 5 minutes by guessing/passing a missionId. Same pattern already
  // applied to /api/missions/[id]/timeline (the non-streaming sibling).
  const mission = await getMission(missionId);
  if (!mission || !(await isTenantMember(user.id, mission.tenantId))) {
    return new Response(JSON.stringify({ error: 'Mission not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
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
          // M7-13c-2b-2b: 'mission_partial' settles a mission too — without it a partial mission's stream would poll for the full 5 minutes.
          const settledOutcome = settledOutcomeOf(timeline);
          if (settledOutcome) {
            controller.enqueue(encoder.encode(formatSSE('mission_completed' as StreamEvent, { missionId, finalEventCount: timeline.length, outcome: settledOutcome })));
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

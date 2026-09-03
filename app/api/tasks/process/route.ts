import { NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/serverClient';
import { getMission, getObjectives, updateTask } from '@/lib/swarm/missionService';
import { executeTask } from '@/lib/swarm/executionLayer';
import { recalculateProgress } from '@/lib/swarm/missionEngine';
import { ok, internalError, fail, rateLimited } from '@/lib/api/response';
import { checkRateLimit, getClientIp } from '@/lib/api/rateLimit';
import type { MissionTask } from '@/lib/swarm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// V1 background task queue processor (Section 5).
//
// The synchronous path (unifiedOrchestrator → missionEngine →
// executionLayer, all within one chat/voice request) remains the primary
// execution path and is unchanged. This route is the queue's consumer:
// it atomically claims a batch of 'ready' tasks via the claim_ready_tasks()
// Postgres function (FOR UPDATE SKIP LOCKED — safe under concurrent
// callers) and executes each one through the SAME executeTask() used by
// the synchronous path — no duplicated execution logic.
//
// Invocation: intended to be called on a schedule (pg_cron + pg_net, or an
// external scheduler hitting this URL) once the app is deployed at a
// stable HTTPS URL — see docs/TEMO-ARCHITECTURE.md for exact setup, since
// Supabase's Postgres cannot reach a local dev server. Requires
// SUPABASE_SERVICE_ROLE_KEY to be configured (never exposed to the
// browser — see lib/supabase/serverClient.ts).
//
// This endpoint is intentionally unauthenticated by user session (a cron
// job has no user) — protect it at the network/scheduler level (a shared
// secret header) if exposed publicly. See docs for the recommended setup.

const QUEUE_SECRET = process.env.TASK_QUEUE_SECRET;

export async function POST(req: Request) {
  const start = Date.now();

  // Fail closed: an unset/empty TASK_QUEUE_SECRET must not fall through to
  // an unauthenticated pass — this route runs with service-role privileges.
  if (!QUEUE_SECRET || req.headers.get('x-queue-secret') !== QUEUE_SECRET) {
    return NextResponse.json(fail('UNAUTHORIZED', 'Invalid queue secret', start), { status: 401 });
  }

  // M1-03: this route executes real tasks (AI calls + tool execution) —
  // rate-limited per calling IP. There's no per-tenant caller here (one
  // invocation can process tasks across many tenants), so IP is the only
  // meaningful bucket key. Sized for a legitimate scheduler polling every
  // few seconds, not for hammering.
  const ipLimit = await checkRateLimit(`tasks-process:ip:${getClientIp(req)}`, { maxTokens: 12, refillPerSec: 1 / 5 });
  if (!ipLimit.allowed) {
    return NextResponse.json(rateLimited(start, ipLimit.resetSeconds), { status: 429 });
  }

  try {
    const client = getServiceRoleClient();
    const { data: claimed, error } = await client.rpc('claim_ready_tasks', {
      claim_limit: 5,
      claimer: 'api-tasks-process',
    });

    if (error) {
      return NextResponse.json(internalError('Failed to claim tasks', start, { error: error.message }), { status: 500 });
    }

    const tasks = (claimed ?? []) as unknown as Array<Record<string, unknown>>;
    if (tasks.length === 0) {
      return NextResponse.json(ok({ processed: 0, results: [] }, start));
    }

    const results: Array<{ taskId: string; status: string }> = [];

    for (const raw of tasks) {
      const task = mapClaimedTask(raw);
      const mission = await getMission(task.missionId);
      if (!mission) {
        // Orphaned task (parent mission gone). Without marking it 'failed'
        // here it stays 'ready' with a stale lock and gets re-claimed by
        // every future run forever — an infinite retry loop on a task that
        // can never succeed.
        await updateTask(task.id, {
          status: 'failed',
          errorMessage: 'Parent mission not found',
          completedAt: new Date().toISOString(),
        });
        results.push({ taskId: task.id, status: 'failed_no_mission' });
        continue;
      }
      const objectives = await getObjectives(mission.id);
      const objective = objectives.find((o) => o.id === task.objectiveId) ?? null;

      const result = await executeTask(task, mission, objective, []);
      results.push({ taskId: task.id, status: result.status });

      // The synchronous mission pipeline rolls mission-level status/progress
      // up itself after each task; this queue path previously never did,
      // so queue-executed missions could stay stuck at status:'executing'
      // forever even after every task finished.
      if (result.status !== 'cancelled') {
        await recalculateProgress(mission.id).catch((err) =>
          console.error('[tasks/process] recalculateProgress failed', mission.id, err),
        );
      }
    }

    return NextResponse.json(ok({ processed: results.length, results }, start));
  } catch (err) {
    return NextResponse.json(internalError('Queue processing failed', start, { error: String(err) }), { status: 500 });
  }
}

// The claim_ready_tasks() RPC returns raw mission_tasks rows (snake_case) —
// reuse the exact shape the row-mapping in missionService expects.
function mapClaimedTask(row: Record<string, unknown>): MissionTask {
  return {
    id: row.id as string,
    missionId: row.mission_id as string,
    objectiveId: (row.objective_id as string) ?? null,
    parentTaskId: (row.parent_task_id as string) ?? null,
    assignedManager: (row.assigned_manager as string) ?? null,
    assignedWorker: (row.assigned_worker as string) ?? null,
    requiredCapability: row.required_capability as string,
    title: row.title as string,
    description: row.description as string,
    priority: row.priority as MissionTask['priority'],
    status: row.status as MissionTask['status'],
    dependencies: Array.isArray(row.dependencies) ? (row.dependencies as string[]) : [],
    retries: (row.retries as number) ?? 0,
    maxRetries: (row.max_retries as number) ?? 3,
    executionLog: Array.isArray(row.execution_log) ? (row.execution_log as MissionTask['executionLog']) : [],
    result: (row.result as Record<string, unknown>) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    maxLoopSteps: (row.max_loop_steps as number) ?? null,
    loopState: (row.loop_state as MissionTask['loopState']) ?? null,
  };
}

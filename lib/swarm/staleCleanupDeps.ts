// M7-13c-2b-3 (Part D) — the real dependency set of the stale-mission cleanup: the existing missionService helpers
// (skipOpenTasks, failRunningTasks, claimMissionTerminalStatus, updateMission, addTimelineEntry) over the shared client.
// Server/script use only: in Node the shared client resolves to the SERVICE-ROLE key (lib/supabase/client.ts), which is why this
// file is imported ONLY by scripts/cleanup-stale-missions.ts and by tests with a faked client — never by app code.
//
// The READ functions at the bottom are plain SELECTs (used by the dry run). The WRITE functions are the ones settleStaleMission
// calls, and only the script's --execute path (explicit ids) reaches them.

import { supabase } from '@/lib/supabase/client';
import {
  addTimelineEntry,
  claimMissionTerminalStatus,
  failRunningTasks,
  getMission,
  getTasks,
  skipOpenTasks,
  updateMission,
} from './missionService';
import { NON_TERMINAL_MISSION_STATUSES } from './types';
import type { CleanupDeps, MissionState, StaleMissionInput } from './staleCleanup';

function toInput(m: NonNullable<Awaited<ReturnType<typeof getMission>>>): StaleMissionInput {
  return { id: m.id, tenantId: m.tenantId, title: m.title, status: m.status, progress: m.progress, createdAt: m.createdAt, updatedAt: m.updatedAt, metadata: m.metadata };
}

export async function lastRuntimeActivityAt(missionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('runtime_activity')
    .select('created_at')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`runtime_activity read failed: ${error.message}`);
  const row = (data ?? [])[0] as { created_at?: string } | undefined;
  return row?.created_at ?? null;
}

export function makeLiveCleanupDeps(): CleanupDeps {
  return {
    now: () => new Date(),
    async loadState(missionId) {
      const mission = await getMission(missionId);
      if (!mission) return null;
      const [tasks, lastActivityAt] = await Promise.all([getTasks(missionId), lastRuntimeActivityAt(missionId)]);
      return { mission: toInput(mission), tasks, lastActivityAt };
    },
    skipOpenTasks: (missionId, reason, meta) => skipOpenTasks(missionId, reason, meta),
    failRunningTasks: (missionId, ids, reason, meta) => failRunningTasks(missionId, ids, reason, meta),
    claim: (missionId, status, progress) => claimMissionTerminalStatus(missionId, status, progress),
    async writeMetadata(missionId, metadata) {
      await updateMission(missionId, { metadata });
    },
    async recordMissionEvent(missionId, eventType, title, detail, meta) {
      await addTimelineEntry({ missionId, eventType, entityType: 'mission', entityId: missionId, title, detail, metadata: meta });
    },
  };
}

// ---- Dry-run reads (SELECT only) --------------------------------------------------------------------------------------

const CHUNK = 40;
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Every mission in a non-terminal status (paused included, so it can be listed as excluded) with its tasks and last runtime activity. */
export async function loadAllNonTerminalStates(): Promise<MissionState[]> {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .in('status', NON_TERMINAL_MISSION_STATUSES)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`missions read failed: ${error.message}`);
  const missionRows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = missionRows.map((r) => String(r.id));

  const tasksByMission = new Map<string, MissionState['tasks']>();
  const activityByMission = new Map<string, string>();
  for (const part of chunks(ids)) {
    const t = await supabase
      .from('mission_tasks')
      .select('id, mission_id, title, status, started_at, updated_at, completed_at, error_message, result, assigned_manager, assigned_worker, retries')
      .in('mission_id', part)
      .limit(5000);
    if (t.error) throw new Error(`mission_tasks read failed: ${t.error.message}`);
    for (const r of (t.data ?? []) as Array<Record<string, unknown>>) {
      const list = tasksByMission.get(String(r.mission_id)) ?? [];
      list.push({
        id: String(r.id), title: String(r.title ?? ''), status: String(r.status), startedAt: (r.started_at as string) ?? null,
        updatedAt: (r.updated_at as string) ?? null, completedAt: (r.completed_at as string) ?? null,
        errorMessage: (r.error_message as string) ?? null, result: (r.result as Record<string, unknown>) ?? null,
        assignedManager: (r.assigned_manager as string) ?? null, assignedWorker: (r.assigned_worker as string) ?? null,
        retries: typeof r.retries === 'number' ? r.retries : 0,
      });
      tasksByMission.set(String(r.mission_id), list);
    }
    const a = await supabase
      .from('runtime_activity')
      .select('mission_id, created_at')
      .in('mission_id', part)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (a.error) throw new Error(`runtime_activity read failed: ${a.error.message}`);
    for (const r of (a.data ?? []) as Array<{ mission_id: string; created_at: string }>) {
      if (!activityByMission.has(r.mission_id)) activityByMission.set(r.mission_id, r.created_at);
    }
  }

  return missionRows.map((r) => ({
    mission: {
      id: String(r.id), tenantId: String(r.tenant_id ?? ''), title: String(r.title ?? ''), status: String(r.status),
      progress: Number(r.progress ?? 0), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    },
    tasks: tasksByMission.get(String(r.id)) ?? [],
    lastActivityAt: activityByMission.get(String(r.id)) ?? null,
  }));
}

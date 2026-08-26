'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Target, ListChecks, Users, History, AlertTriangle, Ban, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { Button } from '@/components/ui/button';
import { GlassPanel, ProgressBar, LoadingSpinner, EmptyState, SectionHeader } from '@/components/temo/primitives';
import { authFetch } from '@/lib/api/authFetch';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Mission, MissionObjective, MissionTask, TimelineEntry } from '@/lib/swarm/types';

const NON_TERMINAL_MISSION_STATUSES: Mission['status'][] = ['pending', 'planning', 'ready', 'executing', 'reviewing', 'paused'];

// M3-08: missions execute synchronously in the browser tab that triggered
// them (lib/swarm/unifiedOrchestrator.ts's runMissionPipeline) — there is
// no server-side scheduler running in this environment to resume a task
// left mid-execution if that tab closes/navigates away before the mission
// finishes (docs/TEMO-ARCHITECTURE.md's "PARTIAL (V1)" task-queue entry;
// claim_ready_tasks() already resets a 'running' task stuck past this same
// 10-minute window back to 'ready', but nothing calls it without a
// pg_cron schedule, which needs a deployed URL this local environment
// doesn't have). A task frozen in 'running' this long, with no error and
// no further log entries, is abandoned — the UI must say so rather than
// showing a static progress bar with no explanation.
const STALLED_TASK_THRESHOLD_MS = 10 * 60 * 1000;

function isTaskStalled(task: MissionTask): boolean {
  if (task.status !== 'running') return false;
  const reference = task.startedAt ?? task.updatedAt;
  if (!reference) return false;
  return Date.now() - new Date(reference).getTime() > STALLED_TASK_THRESHOLD_MS;
}

interface FullMission {
  mission: Mission | null;
  objectives: MissionObjective[];
  tasks: MissionTask[];
  timeline: TimelineEntry[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#F97316', planning: '#F97316', ready: '#EAB308', executing: '#00F3FF',
  reviewing: '#A855F7', completed: '#10B981', failed: '#EF4444', cancelled: '#64748B', paused: '#94A3B8',
  waiting: '#94A3B8', running: '#00F3FF',
};

export default function MissionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<FullMission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefetch = false) => {
    if (!isRefetch) setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/missions/${params.id}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data as FullMission);
      } else {
        setError(json.error?.message ?? 'Failed to load mission');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mission');
    } finally {
      if (!isRefetch) setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <button
          onClick={() => router.push('/missions')}
          className="flex items-center gap-1.5 font-mono text-xs text-temo-titanium transition-colors hover:text-temo-led"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Missions
        </button>

        {loading && (
          <GlassPanel className="flex items-center justify-center p-16">
            <LoadingSpinner label="LOADING MISSION..." />
          </GlassPanel>
        )}

        {!loading && (error || !data?.mission) && (
          <GlassPanel className="p-8">
            <EmptyState
              icon={<AlertTriangle className="h-12 w-12" />}
              title="Mission Not Found"
              description={error ?? 'This mission does not exist or you do not have access to it.'}
              actionLabel="Back to Missions"
              onAction={() => router.push('/missions')}
            />
          </GlassPanel>
        )}

        {!loading && data?.mission && (
          <MissionDetail
            data={data as { mission: Mission; objectives: MissionObjective[]; tasks: MissionTask[]; timeline: TimelineEntry[] }}
            onRefetch={() => load(true)}
          />
        )}
      </div>
    </AppShell>
  );
}

function MissionDetail({
  data,
  onRefetch,
}: {
  data: { mission: Mission; objectives: MissionObjective[]; tasks: MissionTask[]; timeline: TimelineEntry[] };
  onRefetch: () => void;
}) {
  const { mission, objectives, tasks, timeline } = data;
  const accent = STATUS_COLOR[mission.status] ?? '#00F3FF';
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = NON_TERMINAL_MISSION_STATUSES.includes(mission.status);
  const stalledTasks = tasks.filter(isTaskStalled);

  const submitCancel = async () => {
    setCancelling(true);
    try {
      const res = await authFetch(`/api/missions/${mission.id}/cancel`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Mission cancelled' });
        onRefetch();
      } else {
        toast({ title: 'Cancel failed', description: json.error?.message, variant: 'destructive' });
      }
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  };

  return (
    <div className="space-y-6">
      <GlassPanel className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5" style={{ color: accent }} />
              <h1 className="font-sans text-xl font-bold text-temo-led">{mission.title}</h1>
            </div>
            <p className="mt-1 font-mono text-xs text-temo-titanium">{mission.objective}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className="rounded-full border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider"
              style={{ borderColor: `${accent}40`, color: accent, backgroundColor: `${accent}15` }}
            >
              {mission.status}
            </span>
            {mission.isSimulation && (
              <span className="rounded-full border border-temo-purple/40 bg-temo-purple/10 px-2 py-0.5 font-mono text-[10px] text-temo-purple">
                SIMULATION
              </span>
            )}
            {canCancel && !confirmingCancel && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmingCancel(true)}>
                <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel Mission
              </Button>
            )}
            {confirmingCancel && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-red-400">Cancel this mission?</span>
                <Button size="sm" variant="destructive" onClick={submitCancel} disabled={cancelling}>
                  {cancelling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>
                  Back
                </Button>
              </div>
            )}
          </div>
        </div>

        {stalledTasks.length > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="font-mono text-[11px] text-amber-200">
              {stalledTasks.length === 1 ? 'A task hasn’t' : `${stalledTasks.length} tasks haven’t`} progressed in over 10 minutes — still in progress, waiting on task processing. This environment has no automatic background scheduler active, so an interrupted task won’t resume on its own; it will need to be reprocessed manually or the mission restarted.
            </p>
          </div>
        )}

        <div className="mt-4">
          <ProgressBar value={mission.progress} color={accent} />
          <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-temo-titanium">
            <span>{objectives.length} objectives · {tasks.length} tasks</span>
            <span style={{ color: accent }}>{mission.progress}%</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 font-mono text-[11px] text-temo-titanium">
          <span>Priority: <b className="text-temo-led">{mission.priority}</b></span>
          <span>Complexity: <b className="text-temo-led">{mission.estimatedComplexity}</b></span>
          <span>Created: <b className="text-temo-led">{new Date(mission.createdAt).toLocaleString()}</b></span>
          <span>Updated: <b className="text-temo-led">{new Date(mission.updatedAt).toLocaleString()}</b></span>
        </div>
      </GlassPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeader title="Tasks & Assigned Managers" icon={<Users className="h-4 w-4" />} accent={accent} />
          <div className="mt-3 space-y-2">
            {tasks.length === 0 && <p className="font-mono text-xs text-temo-titanium">No tasks yet.</p>}
            {tasks.map((t) => {
              const c = STATUS_COLOR[t.status] ?? '#94A3B8';
              const stalled = isTaskStalled(t);
              return (
                <div key={t.id} className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-sans text-sm text-temo-led">{t.title}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {stalled && (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                          Stalled
                        </span>
                      )}
                      <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase" style={{ color: c, backgroundColor: `${c}15` }}>
                        {t.status}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-temo-titanium">
                    {t.assignedManager && <span>Manager: <b className="text-temo-led">{t.assignedManager}</b></span>}
                    {t.assignedWorker && <span>Worker: <b className="text-temo-led">{t.assignedWorker}</b></span>}
                    {t.retries > 0 && <span>Retries: {t.retries}/{t.maxRetries}</span>}
                  </div>
                  {t.errorMessage && <p className="mt-1 font-mono text-[10px] text-red-400">{t.errorMessage}</p>}
                </div>
              );
            })}
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeader title="Objectives" icon={<ListChecks className="h-4 w-4" />} accent={accent} />
          <div className="mt-3 space-y-2">
            {objectives.length === 0 && <p className="font-mono text-xs text-temo-titanium">No objectives yet.</p>}
            {objectives.map((o) => {
              const c = STATUS_COLOR[o.status] ?? '#94A3B8';
              return (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
                  <span className="font-sans text-sm text-temo-led">{o.title}</span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase" style={{ color: c, backgroundColor: `${c}15` }}>
                    {o.status}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="p-5">
        <SectionHeader title="Timeline" icon={<History className="h-4 w-4" />} accent={accent} />
        <div className="mt-3 max-h-96 space-y-1 overflow-y-auto scrollbar-thin pr-2">
          {timeline.length === 0 && <p className="font-mono text-xs text-temo-titanium">No timeline events yet.</p>}
          {timeline.map((e) => (
            <div key={e.id} className={cn('flex items-start gap-3 rounded-lg px-3 py-2 text-xs', 'hover:bg-white/[0.02]')}>
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-temo-titanium/70">
                {new Date(e.createdAt).toLocaleTimeString()}
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-wider text-temo-cyan/80">{e.eventType}</span>
                <p className="font-sans text-sm text-temo-led">{e.title}</p>
                {e.detail && <p className="truncate font-mono text-[11px] text-temo-titanium">{e.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

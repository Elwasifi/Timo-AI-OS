'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Target, Plus, Search, AlertCircle } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { MissionCard, type Mission as MissionCardData } from '@/components/temo/mission-card';
import { EmptyState, GlassPanel } from '@/components/temo/primitives';
import { useDashboardStore } from '@/stores/dashboardStore';
import { cn } from '@/lib/utils';

const STATUS_TABS = ['All', 'Active', 'Pending', 'Completed', 'Failed'] as const;

export default function MissionsPage() {
  const router = useRouter();
  const missions = useDashboardStore((s) => s.missions);
  const missionsError = useDashboardStore((s) => s.missionsError);
  const loadMissions = useDashboardStore((s) => s.loadMissions);
  const [tab, setTab] = useState<string>('All');
  const [query, setQuery] = useState('');

  // Real missions from the missions table (lib/swarm/missionService.listMissions),
  // via the same shared store slice the Homepage's Mission Control widget can
  // read — not the mock `workflows` array this page used to render.
  // M4-06: previously fetched once on mount only — this page and the
  // Homepage Mission Control widget could silently disagree until a full
  // page reload. Now polls on a reasonable cadence like the rest of the
  // "live" dashboard surfaces.
  useEffect(() => {
    loadMissions();
    const t = setInterval(loadMissions, 15_000);
    return () => clearInterval(t);
  }, [loadMissions]);

  const cardData: MissionCardData[] = missions.map((m) => {
    const startedAt = new Date(m.createdAt).getTime();
    const endedAt = ['completed', 'failed', 'cancelled'].includes(m.status)
      ? new Date(m.updatedAt).getTime()
      : Date.now();
    return {
      id: m.id,
      name: m.title,
      status: m.status,
      progress: m.progress,
      elapsedMs: Number.isFinite(startedAt) ? Math.max(0, endedAt - startedAt) : undefined,
      stepCount: m.estimatedTasks,
      currentStep: m.estimatedTasks > 0 ? Math.round((m.progress / 100) * m.estimatedTasks) : undefined,
    };
  });

  const filtered = cardData.filter((m) => {
    if (tab === 'All') return true;
    if (tab === 'Active') return m.status === 'planning' || m.status === 'ready' || m.status === 'executing' || m.status === 'reviewing';
    if (tab === 'Pending') return m.status === 'pending' || m.status === 'paused';
    if (tab === 'Completed') return m.status === 'completed';
    if (tab === 'Failed') return m.status === 'failed' || m.status === 'cancelled';
    return true;
  }).filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Missions</h1>
            <p className="font-mono text-xs text-temo-titanium">Autonomous multi-agent goal orchestration</p>
          </div>
          <button
            onClick={() => router.push('/chat')}
            title="Missions are launched from a chat request to Temo — this opens Chat"
            className="flex items-center gap-2 rounded-xl bg-temo-automation px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-temo-void transition-all hover:shadow-[0_0_20px_#10B981]"
          >
            <Plus className="h-4 w-4" /> Create Mission
          </button>
        </div>

        {missionsError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load missions: {missionsError}
          </div>
        )}

        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all',
                  tab === t
                    ? 'bg-temo-automation/15 text-temo-automation border border-temo-automation/30'
                    : 'border border-temo-titanium/20 text-temo-titanium hover:text-temo-led'
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-temo-titanium/20 bg-white/[0.02] px-3 py-1.5">
            <Search className="h-4 w-4 text-temo-titanium" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search missions..."
              className="bg-transparent font-mono text-xs text-temo-led placeholder:text-temo-titanium/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Mission board */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((m, i) => (
              <MissionCard key={m.id} mission={m} index={i} onClick={() => router.push(`/missions/${m.id}`)} />
            ))}
          </div>
        ) : (
          <GlassPanel className="p-8">
            <EmptyState
              icon={<Target className="h-12 w-12" />}
              title="No Active Missions"
              description="No autonomous goals match your filters. Missions are launched by asking Temo to build, create, or automate something from Chat."
              actionLabel="Go to Chat"
              onAction={() => router.push('/chat')}
            />
          </GlassPanel>
        )}
      </div>
    </AppShell>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { buildTaskTimeline, formatTaskDuration, type TimelineTone } from '@/lib/swarm/taskTimeline';
import type { MissionTask, TimelineEntry } from '@/lib/swarm/types';
import type { RuntimeActivityRow } from '@/lib/swarm/missionService';

// M7-13c-2b-3 (Part B): the compact, collapsible per-task Timeline (V1: a plain ordered list, not a visual timeline).
// All the data shaping is in lib/swarm/taskTimeline.ts (pure, unit-tested); this component only renders it.

const TONE_COLOR: Record<TimelineTone, string> = {
  neutral: '#94A3B8',
  ok: '#10B981',
  warn: '#F59E0B',
  error: '#EF4444',
  muted: '#64748B',
};

function clock(at: string | null): string {
  if (!at) return '--:--:--';
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString() : '--:--:--';
}

export function TaskTimeline({
  task,
  timeline,
  activity,
  onOpen,
}: {
  task: MissionTask;
  timeline: TimelineEntry[];
  /** Runtime activity of the mission, or null while it has not been loaded / could not be read (then it is simply omitted). */
  activity: RuntimeActivityRow[] | null;
  /** Called the first time the Timeline is opened — the page loads runtime_activity lazily. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const model = useMemo(() => (open ? buildTaskTimeline(task, timeline, activity ?? []) : null), [open, task, timeline, activity]);

  const toggle = () => {
    if (!open) onOpen?.();
    setOpen((o) => !o);
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-temo-cyan/80 hover:text-temo-cyan"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Timeline
      </button>

      {model && (
        <div className="mt-2 space-y-2 rounded-md border border-white/[0.05] bg-black/20 p-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-temo-titanium">
            <span>Start: <b className="text-temo-led">{clock(model.summary.startedAt)}</b></span>
            <span>End: <b className="text-temo-led">{model.summary.endedAt ? clock(model.summary.endedAt) : model.summary.status === 'running' ? 'running…' : '—'}</b></span>
            <span>Duration: <b className="text-temo-led">{formatTaskDuration(model.summary.durationMs)}</b></span>
            <span>Agent: <b className="text-temo-led">{[model.summary.manager, model.summary.worker].filter(Boolean).join(' → ') || '—'}</b></span>
            {model.summary.retries > 0 && <span>Retries: <b className="text-amber-300">{model.summary.retries}/{model.summary.maxRetries}</b></span>}
            {model.summary.simulated && (
              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 uppercase text-sky-300">
                {model.summary.simulated === 'simulated' ? 'Simulated' : 'Simulated in Live mode'}
              </span>
            )}
            {model.summary.executionMode && <span>Mode: <b className="text-temo-led">{model.summary.executionMode}</b></span>}
          </div>

          {model.summary.providers.length > 0 && (
            <p className="font-mono text-[10px] text-temo-titanium">
              Provider{model.summary.providers.length > 1 ? 's' : ''}: <b className="text-temo-led">{model.summary.providers.join(' → ')}</b>
              {model.summary.providers.length > 1 && <span className="text-amber-300"> (moved to another provider)</span>}
            </p>
          )}
          {model.summary.tools.length > 0 && (
            <p className="font-mono text-[10px] text-temo-titanium">Tools: <b className="text-temo-led">{model.summary.tools.join(', ')}</b></p>
          )}
          {model.summary.reason && (
            <p className="font-mono text-[10px]" style={{ color: TONE_COLOR[model.summary.status === 'failed' ? 'error' : 'muted'] }}>
              {model.summary.status === 'skipped' ? 'Skipped — ' : model.summary.failureKind ? `Failed (${model.summary.failureKind}) — ` : ''}
              {model.summary.reason}
            </p>
          )}
          {model.summary.resultSummary && <p className="font-mono text-[10px] text-temo-titanium">Result: {model.summary.resultSummary}</p>}

          {model.rows.length === 0 ? (
            <p className="font-mono text-[10px] text-temo-titanium">No events recorded for this task yet.</p>
          ) : (
            <ol className="space-y-1">
              {model.rows.map((r) => (
                <li key={r.id} className="flex items-start gap-2 font-mono text-[10px]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TONE_COLOR[r.tone] }} />
                  <span className="shrink-0 text-temo-titanium/70">{clock(r.at)}</span>
                  <span className="min-w-0">
                    <span style={{ color: TONE_COLOR[r.tone] }}>{r.label}</span>
                    {r.source === 'runtime' && <span className="text-temo-titanium/60"> · runtime</span>}
                    {r.detail && <span className="text-temo-titanium"> — {r.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

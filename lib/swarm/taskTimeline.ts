// M7-13c-2b-3 (Part B) — the per-task Timeline row model. PURE: no React, no Supabase, no I/O.
//
// Built only from data the mission detail page already has or cheaply loads:
//   - the mission_tasks row (started/completed times, retries, agent, status, error text, result summary),
//   - the mission_timeline entries whose entity_id is the task (task_assigned, task_started, execution_retried,
//     tool_selected, tool_decision_outcome, provider_selected, execution_finished / failed, task_skipped, ...),
//   - runtime_activity rows for the task (optional; the page omits them if they cannot be read).
// Reasons and summaries always go through cleanReason / a JSON-safe summary — never raw JSON. An event type this module has
// never heard of is shown generically (humanized), it never throws.

import { cleanReason, readSimulation } from './missionOutcome';

export type TimelineTone = 'neutral' | 'ok' | 'warn' | 'error' | 'muted';

export interface TaskTimelineRow {
  id: string;
  source: 'task' | 'timeline' | 'runtime';
  /** The raw event type ('task_started', 'execution_retried', ... or anything unknown). */
  kind: string;
  /** ISO time, or null when the source had no usable time (such rows sort last, in input order). */
  at: string | null;
  label: string;
  detail: string;
  tone: TimelineTone;
}

export interface TaskTimelineSummary {
  status: string;
  startedAt: string | null;
  /** Only set for a task that is over (completed / failed / skipped / cancelled). */
  endedAt: string | null;
  durationMs: number | null;
  manager: string | null;
  worker: string | null;
  /** 'simulated' = intended simulation (Demo); 'anomalous' = simulated although the task ran in Live mode. null = real work. */
  simulated: 'simulated' | 'anomalous' | null;
  executionMode: string | null;
  retries: number;
  maxRetries: number;
  /** Distinct providers in the order they were selected. More than one means the task moved to another provider. */
  providers: string[];
  tools: string[];
  /** Why a failed / skipped / cancelled task ended that way (cleanReason). Null otherwise. */
  reason: string | null;
  /** Failure kind recorded with a failed task (e.g. 'timeout'), when present. */
  failureKind: string | null;
  /** One-line, JSON-free summary of a completed task's output. Null otherwise. */
  resultSummary: string | null;
}

export interface TaskTimeline {
  summary: TaskTimelineSummary;
  rows: TaskTimelineRow[];
}

/** The fields of a mission task this module reads. MissionTask satisfies it structurally. */
export interface TimelineTaskInput {
  id: string;
  status: string;
  assignedManager?: string | null;
  assignedWorker?: string | null;
  retries?: number;
  maxRetries?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
}

/** The fields of a mission_timeline entry this module reads. TimelineEntry satisfies it structurally. */
export interface TimelineEntryInput {
  id: string;
  eventType: string;
  entityId: string | null;
  title: string;
  detail: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/** The fields of a runtime_activity row this module reads. RuntimeActivityRow satisfies it structurally. */
export interface ActivityRowInput {
  id: string;
  eventType: string;
  title: string;
  detail: string;
  taskId: string | null;
  status: string | null;
  createdAt: string;
}

const DETAIL_CAP = 200;
const ENDED_STATUSES = new Set(['completed', 'failed', 'skipped', 'cancelled']);

function humanize(raw: string): string {
  const t = raw.replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Event';
}

/** A one-line, brace-free, capped text. Never raw JSON: a text that is JSON (starts with { or [) becomes a neutral note. */
export function tidyText(raw: unknown, cap = DETAIL_CAP): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) return 'Structured data recorded.';
  const noBraces = text.replace(/[{}]/g, '').trim();
  return noBraces.length > cap ? `${noBraces.slice(0, cap - 1).trimEnd()}…` : noBraces;
}

interface EventStyle {
  label: string;
  tone: TimelineTone;
  /** Error-like details go through cleanReason (provider JSON bodies are reduced to their message). */
  reasonDetail?: boolean;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  task_assigned: { label: 'Assigned', tone: 'neutral' },
  task_started: { label: 'Started', tone: 'neutral' },
  execution_started: { label: 'Execution started', tone: 'neutral' },
  decision_made: { label: 'Decision made', tone: 'neutral' },
  pipeline_selected: { label: 'Pipeline selected', tone: 'neutral' },
  memory_retrieved: { label: 'Memory retrieved', tone: 'neutral' },
  knowledge_retrieved: { label: 'Knowledge retrieved', tone: 'neutral' },
  tool_selected: { label: 'Tool selected', tone: 'neutral' },
  tool_decision_outcome: { label: 'Tool decision', tone: 'neutral' },
  workflow_executed: { label: 'Workflow executed', tone: 'neutral' },
  provider_selected: { label: 'Provider selected', tone: 'neutral' },
  execution_retried: { label: 'Retry', tone: 'warn', reasonDetail: true },
  execution_finished: { label: 'Execution finished', tone: 'ok' },
  task_completed: { label: 'Completed', tone: 'ok' },
  execution_failed: { label: 'Execution failed', tone: 'error', reasonDetail: true },
  task_failed: { label: 'Failed', tone: 'error', reasonDetail: true },
  task_skipped: { label: 'Skipped', tone: 'muted', reasonDetail: true },
};

function timeOf(at: string | null): number {
  if (!at) return Number.POSITIVE_INFINITY;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function validIso(at: string | null | undefined): string | null {
  if (!at) return null;
  return Number.isFinite(new Date(at).getTime()) ? at : null;
}

function rowFromEntry(e: TimelineEntryInput): TaskTimelineRow {
  const style = EVENT_STYLES[e.eventType];
  const detailSource = e.detail || '';
  return {
    id: `tl:${e.id}`,
    source: 'timeline',
    kind: e.eventType,
    at: validIso(e.createdAt),
    label: style ? style.label : humanize(String(e.eventType ?? '')),
    // Known events keep the recorded detail (the title when there is none); an unknown event shows its title generically.
    detail: style?.reasonDetail && detailSource ? cleanReason(detailSource) : tidyText(detailSource || e.title),
    tone: style ? style.tone : 'neutral',
  };
}

function rowFromActivity(a: ActivityRowInput): TaskTimelineRow {
  const tone: TimelineTone = a.status === 'failed' ? 'error' : a.status === 'completed' ? 'ok' : 'neutral';
  return {
    id: `rt:${a.id}`,
    source: 'runtime',
    kind: a.eventType,
    at: validIso(a.createdAt),
    label: tidyText(a.title, 80) || humanize(a.eventType),
    detail: tone === 'error' && a.detail ? cleanReason(a.detail) : tidyText(a.detail),
    tone,
  };
}

function summarizeOutput(result: Record<string, unknown>): string | null {
  const out = result.output;
  if (typeof out !== 'string') return null;
  const t = tidyText(out, 160);
  return t || null;
}

function toolsOf(result: Record<string, unknown>, entries: TimelineEntryInput[]): string[] {
  const names: string[] = [];
  const add = (v: unknown) => { if (typeof v === 'string' && v && !names.includes(v)) names.push(v); };
  if (Array.isArray(result.tools)) result.tools.forEach(add);
  for (const e of entries) {
    const ids = e.eventType === 'tool_selected' ? (e.metadata ?? {}).toolIds : undefined;
    if (Array.isArray(ids)) ids.forEach(add);
  }
  return names;
}

function providersOf(entries: TimelineEntryInput[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.eventType !== 'provider_selected') continue;
    const name = /^Provider:\s*(.+)$/i.exec((e.title ?? '').trim())?.[1]?.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The ordered Timeline of ONE task. Rows are sorted by time (stable: equal or unusable times keep their input order, rows
 * without a time go last). Entries and activity rows of other tasks are ignored. A task with no events yet still gets its
 * summary (and, when the task row itself records a start / end, synthetic "Started" / end rows).
 */
export function buildTaskTimeline(
  task: TimelineTaskInput,
  timelineEntries: ReadonlyArray<TimelineEntryInput> = [],
  activityRows: ReadonlyArray<ActivityRowInput> = [],
): TaskTimeline {
  const own = timelineEntries.filter((e) => e.entityId === task.id);
  const ownActivity = activityRows.filter((a) => a.taskId === task.id);
  const result = (task.result && typeof task.result === 'object' ? task.result : {}) as Record<string, unknown>;

  const rows: TaskTimelineRow[] = [...own.map(rowFromEntry), ...ownActivity.map(rowFromActivity)];

  // Synthetic rows from the task row itself, only where no event already says it (events can be missing or late).
  const hasKind = (...kinds: string[]) => own.some((e) => kinds.includes(e.eventType));
  const startedAt = validIso(task.startedAt);
  const completedAt = validIso(task.completedAt);
  if (startedAt && !hasKind('task_started', 'execution_started')) {
    rows.push({ id: `task:${task.id}:start`, source: 'task', kind: 'task_started', at: startedAt, label: 'Started', detail: '', tone: 'neutral' });
  }
  if (completedAt && ENDED_STATUSES.has(task.status) && !hasKind('task_completed', 'task_failed', 'task_skipped', 'execution_finished', 'execution_failed')) {
    const end: Record<string, { label: string; tone: TimelineTone }> = {
      completed: { label: 'Completed', tone: 'ok' },
      failed: { label: 'Failed', tone: 'error' },
      skipped: { label: 'Skipped', tone: 'muted' },
      cancelled: { label: 'Cancelled', tone: 'muted' },
    };
    rows.push({
      id: `task:${task.id}:end`, source: 'task', kind: `task_${task.status}`, at: completedAt, label: end[task.status].label,
      detail: task.status === 'completed' ? '' : cleanReason(task.errorMessage), tone: end[task.status].tone,
    });
  }

  // Drop a runtime row that repeats an existing row (same label, detail and second).
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.label}|${r.detail}|${Math.floor(timeOf(r.at) / 1000)}`;
    if (r.source === 'runtime' && seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const ordered = unique
    .map((r, index) => ({ r, index }))
    .sort((a, b) => {
      const ta = timeOf(a.r.at);
      const tb = timeOf(b.r.at);
      if (ta === tb) return a.index - b.index; // also covers two rows without a time
      return ta < tb ? -1 : 1;
    })
    .map((x) => x.r);

  const sim = readSimulation(result);
  const retryEvents = own.filter((e) => e.eventType === 'execution_retried').length;
  const ended = ENDED_STATUSES.has(task.status);
  const durationMs = startedAt && completedAt && ended ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null;
  const agent = (result.agent && typeof result.agent === 'object' ? result.agent : {}) as { manager?: unknown; worker?: unknown };
  const failure = (result.failure && typeof result.failure === 'object' ? result.failure : {}) as { kind?: unknown };

  const summary: TaskTimelineSummary = {
    status: task.status,
    startedAt,
    endedAt: ended ? completedAt : null,
    durationMs,
    manager: (typeof agent.manager === 'string' && agent.manager) || task.assignedManager || null,
    worker: (typeof agent.worker === 'string' && agent.worker) || task.assignedWorker || null,
    simulated: sim.simulated ? (sim.intended ? 'simulated' : 'anomalous') : null,
    executionMode: sim.executionMode,
    retries: Math.max(task.retries ?? 0, retryEvents),
    maxRetries: task.maxRetries ?? 0,
    providers: providersOf(own),
    tools: toolsOf(result, own),
    reason: task.status === 'failed' || task.status === 'skipped' || task.status === 'cancelled'
      ? (task.errorMessage ? cleanReason(task.errorMessage) : task.status === 'failed' ? 'No reason was recorded.' : null)
      : null,
    failureKind: typeof failure.kind === 'string' ? failure.kind : null,
    resultSummary: task.status === 'completed' ? summarizeOutput(result) : null,
  };

  return { summary, rows: ordered };
}

/** "1m 05s" / "12s" / "340ms" for a duration; "—" when unknown. */
export function formatTaskDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

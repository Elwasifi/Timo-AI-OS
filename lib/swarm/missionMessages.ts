// M7-13c-2b-1 — the mission's chat/report text, written from the SAME MissionOutcome object that decided its status
// (lib/swarm/missionOutcome.ts). PURE.
//
// Two renderers over the same structured per-task report data:
//   BRIEF (default, the chat reply): the mission result(s) only — no agents, methods or tools. Failure reasons and
//         "Simulated" tags stay visible (honesty).
//   FULL: per task — title, who executed it (manager and worker), the method (steps), the tools used, the result,
//         the duration, the Simulated tag, and the reason when it failed.
// Wording rules: "partial" is only said for a partial outcome; 0 succeeded says "Mission failed: 0 of N tasks
// succeeded" with one line per failed task; simulated work is never described as real.

import { isSuccess, type MissionOutcome, type TaskReport, type TaskOutcomeState } from './missionOutcome';

export type DetailLevel = 'brief' | 'full';

export interface MissionMessageOptions {
  detail?: DetailLevel;
  /** Mission title for the heading (optional). */
  title?: string;
}

export const SIMULATED_SENTENCE = 'Simulated — no real action was taken.';

const FULL_EXCERPT = 600;

function excerpt(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return 'not recorded';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const STATE_LABEL: Record<TaskOutcomeState, string> = {
  succeeded: 'Completed',
  simulated: 'Completed (Simulated)',
  anomalous: 'Not counted (simulated while in Live mode)',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
  open: 'Not finished',
};

function statusLine(o: MissionOutcome): string {
  const c = o.counts;
  const ok = c.succeeded + c.simulated;
  const simNote = c.simulated > 0
    ? (c.succeeded === 0 ? ` ${SIMULATED_SENTENCE}` : ` ${c.simulated} of them simulated — no real action was taken for those.`)
    : '';
  switch (o.status) {
    case 'completed':
      return `Mission completed: ${ok} of ${c.total} tasks succeeded.${simNote}`;
    case 'partial':
      return `Mission partially done: ${ok} of ${c.total} tasks succeeded.${simNote}`;
    case 'failed':
      return c.total === 0 ? 'Mission failed: no tasks were created.' : `Mission failed: ${ok} of ${c.total} tasks succeeded.`;
    case 'cancelled':
      return 'Mission cancelled.';
    case 'in_progress':
      return `Mission in progress: ${c.total - c.open} of ${c.total} tasks finished.`;
  }
}

function reasonLines(title: string, tasks: TaskReport[]): string[] {
  if (tasks.length === 0) return [];
  return [`### ${title}`, ...tasks.map((t) => `- ${t.title}: ${t.reason ?? 'No reason was recorded.'}`), ''];
}

function briefBody(o: MissionOutcome): string[] {
  const done = o.parts.tasks.filter((t) => isSuccess(t.state));
  const lines: string[] = [];

  // Temo returns the final synthesized result — the last real task's output — IN FULL (never an excerpt, also when
  // the mission is only partly done), then one title-only line per other succeeded task.
  const real = done.filter((t) => t.state === 'succeeded' && t.result);
  const finalResult = real[real.length - 1];

  if (o.status === 'completed') {
    if (finalResult) lines.push(finalResult.result, '');
    for (const t of done.filter((d) => d.state === 'simulated')) lines.push(`- ${t.title} — ${SIMULATED_SENTENCE}`);
    if (done.some((d) => d.state === 'simulated')) lines.push('');
  } else if (done.length > 0 && (o.status === 'partial' || o.status === 'in_progress')) {
    if (finalResult) lines.push(finalResult.result, '');
    const others = done.filter((d) => d !== finalResult);
    if (others.length > 0) {
      lines.push(finalResult ? '### Also done' : o.status === 'partial' ? '### What was done' : '### Done so far');
      for (const t of others) lines.push(t.state === 'simulated' ? `- ${t.title} — ${SIMULATED_SENTENCE}` : `- ${t.title}`);
      lines.push('');
    }
  }

  lines.push(...reasonLines(o.status === 'failed' ? 'What went wrong' : 'What failed and why', o.parts.failed));
  lines.push(...reasonLines('What remains and why', o.parts.remaining));
  return lines;
}

function fullBlock(t: TaskReport, index: number): string[] {
  const who = t.manager ? `${t.manager}${t.worker ? ` → ${t.worker}` : ''}` : 'not recorded';
  const lines = [
    `### ${index}. ${t.title} — ${STATE_LABEL[t.state]}`,
    `- Executed by: ${who}`,
    `- Method: ${t.method.length > 0 ? t.method.join(' → ') : 'not recorded'}`,
    `- Tools: ${t.tools.length > 0 ? t.tools.join(', ') : 'none'}`,
    `- Duration: ${formatDuration(t.durationMs)}`,
  ];
  if (t.state === 'succeeded') lines.push(`- Result: ${t.result ? excerpt(t.result, FULL_EXCERPT) : 'no text result recorded'}`);
  if (t.state === 'simulated') lines.push(`- Result: ${SIMULATED_SENTENCE}`);
  if (t.reason) lines.push(`- ${t.state === 'failed' ? 'Reason' : 'Note'}: ${t.reason}`);
  if (t.retries > 0) lines.push(`- Retries: ${t.retries}`);
  lines.push('');
  return lines;
}

/** The mission's report text. Default detail is 'brief' (the chat reply). */
export function buildMissionResponse(outcome: MissionOutcome, options: MissionMessageOptions = {}): string {
  const detail: DetailLevel = options.detail ?? 'brief';
  const lines: string[] = [];
  if (options.title) lines.push(`## Mission: ${options.title}`, '');
  lines.push(statusLine(outcome), '');
  if (detail === 'full') {
    outcome.parts.tasks.forEach((t, i) => lines.push(...fullBlock(t, i + 1)));
  } else {
    lines.push(...briefBody(outcome));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

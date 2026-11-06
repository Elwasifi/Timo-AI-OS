// M7-13c-2b-3 (Part D) — local admin script: clean up abandoned ("stale") missions. NOT an API route, NOT reachable from the browser.
//
//   DRY RUN (default, read-only SELECTs only):
//     node --experimental-transform-types --import ./scripts/register-ts-alias.mjs scripts/cleanup-stale-missions.ts
//   EXECUTE (explicit ids required; every id must still be a current candidate; a BEFORE snapshot is written first):
//     node --experimental-transform-types --import ./scripts/register-ts-alias.mjs scripts/cleanup-stale-missions.ts --execute --ids <id>,<id>
//     node --experimental-transform-types --import ./scripts/register-ts-alias.mjs scripts/cleanup-stale-missions.ts --execute --ids-file ids.txt
//
// Credentials come from .env.local / .env (service-role key) and are never printed. Rules, thresholds and the settle sequence
// live in lib/swarm/staleCleanup.ts (pure, unit-tested). NO row is ever deleted.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local then .env into process.env BEFORE the supabase client module is imported (it reads process.env at import time).
for (const file of ['.env.local', '.env']) {
  const filePath = path.join(root, file);
  if (!existsSync(filePath)) continue;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

// (no top-level await: the project's tsconfig targets es5, so the script body lives in main())
async function main(): Promise<void> {
  const cleanup = await import('@/lib/swarm/staleCleanup');
  const {
    STALE_MISSION_AGE_MS, NO_RUNTIME_ACTIVITY_WINDOW_MS, NEAR_THRESHOLD_MS, CANDIDATE_STATUSES, SKIP_REASON, INTERRUPT_REASON,
    evaluateStaleMission, planSettlement, parseCleanupArgs, validateExecuteIds, settleStaleMission, buildBeforeSnapshot, formatDuration,
  } = cleanup;

  const args = parseCleanupArgs(process.argv.slice(2), (p: string) => readFileSync(p, 'utf8'));
  if (args.error) {
    console.error(`REFUSED: ${args.error}`);
    process.exit(2);
  }

  const host = (() => {
    try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname; } catch { return '(unknown)'; }
  })();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('REFUSED: SUPABASE_SERVICE_ROLE_KEY is not set (.env.local) — the script needs the service-role client.');
    process.exit(2);
  }

  const deps = await import('@/lib/swarm/staleCleanupDeps');

  const now = new Date();
  console.log(`Stale-mission cleanup — ${args.execute ? 'EXECUTE' : 'DRY RUN (read-only)'} — ${now.toISOString()}`);
  console.log(`Database host: ${host}`);
  console.log('Thresholds:');
  console.log(`  candidate statuses        : ${CANDIDATE_STATUSES.join(', ')}  (never paused, never a terminal status)`);
  console.log(`  STALE_MISSION_AGE_MS      : ${STALE_MISSION_AGE_MS} (${formatDuration(STALE_MISSION_AGE_MS)}) — updated_at must be older`);
  console.log(`  NO_RUNTIME_ACTIVITY_WINDOW: ${NO_RUNTIME_ACTIVITY_WINDOW_MS} (${formatDuration(NO_RUNTIME_ACTIVITY_WINDOW_MS)}) — no runtime_activity within`);
  console.log(`  NEAR_THRESHOLD_MS         : ${NEAR_THRESHOLD_MS} (${formatDuration(NEAR_THRESHOLD_MS)}) — listed as "close to the threshold"`);
  console.log(`  also excluded             : any task awaiting_approval; any task changed within the threshold`);
  console.log(`  skip reason               : ${SKIP_REASON}`);
  console.log(`  interrupt reason          : ${INTERRUPT_REASON}`);
  console.log('');

  const states = await deps.loadAllNonTerminalStates();
  const evaluated = states.map((s) => ({ s, ev: evaluateStaleMission({ mission: s.mission, tasks: s.tasks, lastActivityAt: s.lastActivityAt, now }) }));
  const candidates = evaluated.filter((e) => e.ev.verdict === 'candidate');
  const notStale = evaluated.filter((e) => e.ev.verdict === 'not_stale');
  const excluded = evaluated.filter((e) => e.ev.verdict === 'excluded');

  const countsOf = (tasks: Array<{ status: string }>) => {
    const c: Record<string, number> = {};
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    const text = Object.entries(c).map(([k, v]) => `${k}:${v}`).join(' ');
    return text || '(no tasks)';
  };
  const trunc = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const when = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 19) : 'none');

  console.log(`Missions in a non-terminal status: ${states.length}  ->  candidates: ${candidates.length}, not stale yet: ${notStale.length}, excluded: ${excluded.length}`);
  console.log('');
  console.log(`=== CANDIDATES (${candidates.length}) — would be cleaned up if their ids are passed with --execute ===`);
  candidates.forEach(({ s, ev }, i) => {
    const plan = planSettlement(s.tasks);
    console.log(`[${i + 1}] ${s.mission.id}`);
    console.log(`    tenant        : ${s.mission.tenantId}`);
    console.log(`    title         : ${trunc(s.mission.title.replace(/\s+/g, ' '), 70)}`);
    console.log(`    status/progress: ${s.mission.status} / ${s.mission.progress}%`);
    console.log(`    created_at    : ${s.mission.createdAt}`);
    console.log(`    updated_at    : ${s.mission.updatedAt}   (age ${formatDuration(ev.ageMs)})`);
    console.log(`    last activity : ${when(s.lastActivityAt)}`);
    console.log(`    tasks         : ${countsOf(s.tasks)}`);
    console.log(`    would settle  : ${plan.wouldStatus ?? 'NOT TOUCHED'} — skip ${plan.toSkip.length} open task(s), fail ${plan.toFail.length} running task(s); ${plan.explanation}`);
    console.log(`    reasons       : ${ev.reasons.join('; ')}`);
  });
  console.log('');
  console.log(`=== NOT STALE YET (${notStale.length}) — not touched; "near" = at least ${formatDuration(NEAR_THRESHOLD_MS)} old ===`);
  notStale.forEach(({ s, ev }) => {
    console.log(`- ${s.mission.id}  ${s.mission.status.padEnd(9)} ${String(s.mission.progress).padStart(3)}%  ${ev.nearThreshold ? 'NEAR ' : '     '} ${trunc(s.mission.title.replace(/\s+/g, ' '), 40).padEnd(40)}  ${ev.reasons.join('; ')}  tasks[${countsOf(s.tasks)}]`);
  });
  console.log('');
  console.log(`=== EXCLUDED (${excluded.length}) — never touched ===`);
  excluded.forEach(({ s, ev }) => {
    console.log(`- ${s.mission.id}  ${s.mission.status.padEnd(9)} ${String(s.mission.progress).padStart(3)}%  updated ${when(s.mission.updatedAt)}  ${trunc(s.mission.title.replace(/\s+/g, ' '), 40).padEnd(40)}  ${ev.reasons.join('; ')}  tasks[${countsOf(s.tasks)}]`);
  });
  console.log('');

  if (!args.execute) {
    console.log('DRY RUN — nothing was written. To execute, re-run with --execute and an explicit --ids / --ids-file list taken from the candidates above.');
    process.exit(0);
  }

  // ---- EXECUTE ----------------------------------------------------------------------------------------------------------
  const { accepted, refused } = validateExecuteIds(args.ids, candidates.map((c) => c.s.mission.id));
  if (refused.length > 0) {
    for (const r of refused) console.error(`REFUSED: ${r.id} — ${r.reason}`);
    console.error('Nothing was changed: every requested id must be a current stale candidate.');
    process.exit(3);
  }

  const snapshotDir = path.join(os.tmpdir(), 'temo-cleanup-snapshots');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, `before-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(snapshotPath, JSON.stringify(buildBeforeSnapshot(candidates.filter((c) => accepted.includes(c.s.mission.id)).map((c) => c.s), now), null, 2), 'utf8');
  console.log(`BEFORE snapshot written: ${snapshotPath}`);

  const live = deps.makeLiveCleanupDeps();
  for (const id of accepted) {
    try {
      const report = await settleStaleMission(id, live);
      console.log(`${report.settled ? 'SETTLED' : 'SKIPPED'} ${id} -> ${report.status ?? '-'}  skipped:${report.skipped} interrupted:${report.interrupted}  ${report.note}`);
    } catch (e) {
      console.error(`ERROR ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

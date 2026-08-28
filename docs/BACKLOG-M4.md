# Milestone 4 — Mission-Execution Reliability + Live-Data Honesty Backlog

> Owner: Claude Cowork (Technical Manager). Implemented by: Claude Code (local). Status values: `Open` → `In Progress` → `Pushed for Review` → `Reviewed — ready to merge` → `Merged`.
> Branch: `milestone-4-mission-reliability`, checked out locally for the whole milestone, one commit per ticket pushed immediately after each is done and live-verified, per `docs/GOVERNANCE.md`'s branching model.
> Source: the Critical/High findings from the read-only Operational Integrity Audit (2026-08-27) — the audit's own report is not duplicated here, only the resulting tickets.
> Sequencing: M4-01 through M4-04 first (direct cause of the "fake mission success" trust problem). M4-05 through M4-07 next.
> **Explicitly out of scope for this milestone (a separate, later pass): fake `systemStore` health/events data, delegation visibility, dead-code cleanup, dead buttons/commands.**

---

## M4-01 — Fix task-text-vs-original-request bug feeding detectIntent()
**Priority:** Critical
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-01" section.

Root cause confirmed in the audit: `lib/swarm/executionLayer.ts:166` builds `taskText` from the mission-planner's generic paraphrase (e.g. "Design the automation workflow") instead of the user's original request (e.g. "create a workflow for managing WhatsApp"), and feeds that into `detectIntent()`. `lib/context/intent-detector.ts:101`'s n8n-intent regex matches the original request but not the paraphrase, so tool routing falls through to the wrong category and lands on `lib/tools/builtin-tools.ts:229`'s `placeholderHandler()` instead of the real n8n tool.

**Acceptance criteria:**
- `detectIntent()` (or the task-text construction feeding it) has access to and uses the real originating user request for a mission task, not only the planner's paraphrased task title/description — carry the original request on the mission/task record if it isn't already, rather than trying to reverse-engineer it from the paraphrase.
- Live-verified: trigger a real "create a workflow for managing X" mission end to end, confirm `detectIntent()` correctly identifies the n8n intent from the task's execution context and the real `n8n.createWorkflow` tool is invoked — not the placeholder.

## M4-02 — Placeholder tools must signal failure, not fake success
**Priority:** Critical
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-02" section.

`lib/tools/builtin-tools.ts`'s `placeholderHandler()` (`files.read`, `files.write`, `web.search`, and any other `'beta'`-status stub) always returns a canned success-looking string with no way for the caller to know nothing real happened — a fake-success trap for any task that lands on one of these tools, not just the M4-01 case.

**Acceptance criteria:**
- `placeholderHandler()` returns an explicit failure/not-implemented result (not a success shape with placeholder text) OR these tools are removed from the planner's candidate pool entirely until real adapters exist — no placeholder tool may ever report success.
- `lib/context/tool-decision.ts`'s existing "never fabricate success" principle actually holds for this case — verify the caller correctly treats this as a failure and falls into normal retry/error handling, not a silent "done."
- Live-verified: trigger a task that lands on a placeholder tool, confirm it now surfaces as a real failure end to end (task status, mission status, and `lessons_learned` all reflect it honestly).

## M4-03 — Surface lessons_learned partial-failure signal in the mission UI
**Priority:** Critical
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-03" section.

`lib/swarm/missionEngine.ts:378`'s `recalculateProgress()` correctly writes a `'partial_failure'` `lessons_learned` row when a mission completes with some failed tasks, but grep-confirmed no UI component ever reads/displays it — the one honest signal in the system is currently invisible to the user.

**Acceptance criteria:**
- `app/missions/[id]/page.tsx` (or wherever makes sense) surfaces this signal clearly when it exists for that mission — a visible banner distinct from M3-08's "stalled" one, since this is a different state (mission finished, but not fully successfully).
- Live-verified against a real mission with a `partial_failure` row.

## M4-04 — Timeout guard on VoicePlayer.speak()
**Priority:** Critical
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-04" section.

`lib/voice/voice-player.ts`'s `speak()` promise only resolves via the browser's `onend`/`onerror` callback on `SpeechSynthesisUtterance`, with no timeout anywhere in the chain — a well-documented real Web Speech API flakiness. If neither callback ever fires, `voice-manager.ts`'s `isProcessingVoice` flag stays `true` forever, silently swallowing every future voice attempt with zero error shown.

**Acceptance criteria:**
- `speak()` has a reasonable hard timeout after which it resolves/rejects on its own and the caller's `isProcessingVoice` flag is guaranteed to reset.
- A timeout firing surfaces a real, visible error via the existing M3-10 voice error-state mechanism (`stores/voiceStore.ts`'s `setError()`) — never silent.
- Live-verified: force a stuck synthesis (simulate `onend` never firing) and confirm the app recovers and shows an error instead of permanently wedging.

## M4-05 — Re-validate n8n connection status instead of trusting stale cache
**Priority:** High
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-05" section.

`app_settings.n8n_connection_status` currently shows a stale `"connected":true` even though the audit confirmed the configured Cloudflare tunnel URL is DNS-dead right now — actively misleading, and it independently corroborates M4-01/M4-02's finding that real n8n calls can't currently succeed.

**Acceptance criteria:**
- The connection status is re-validated on a reasonable cadence (or on-demand when the Settings → n8n page is viewed, at minimum) rather than trusted indefinitely from whenever it was last set.
- A dead/unreachable n8n endpoint is reflected honestly in the UI, not shown as connected.
- Live-verified against the real current (dead) tunnel URL, then again after Amro provides a working one.

## M4-06 — Make "live" dashboard widgets actually live, or label them as snapshots
**Priority:** High
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-06" section.

Confirmed: every "live" widget on Main Dashboard (`command-widgets.tsx`, `command-deck.tsx`'s `MissionWidget`, etc.) fetches exactly once on mount with zero polling/revalidation — the direct, confirmed cause of "needs a manual refresh every minute for things to work."

**Acceptance criteria:**
- Add reasonable polling/revalidation to widgets that are presented as live (reuse existing patterns like `right-sidebar.tsx`'s polling where appropriate) OR clearly relabel any widget that stays a point-in-time snapshot so it doesn't imply liveness it doesn't have.
- Also fix `stores/dashboardStore.ts:407`'s empty catch block in `loadMissions()` — a query failure currently leaves stale/empty state with zero user-facing signal; surface a real error state instead.
- Live-verified: leave Main Dashboard open, trigger a real state change (new mission, task progress) from elsewhere, confirm the widget reflects it without a manual page refresh.

## M4-07 — Parallelize getExecutionStats()'s per-mission task fetch
**Priority:** High
**Status:** Merged (main@acac47a). Live-verified. See `docs/TEMO-ARCHITECTURE.md`'s dated "M4-07" section.

`lib/dashboard/dashboardService.ts:255`'s `getExecutionStats()` loops `await getTasks(m.id)` sequentially across up to 200 missions — a real, worsening N+1 pattern that runs on every Main Dashboard mount via `AnalyticsWidget`.

**Acceptance criteria:**
- Replace the sequential loop with `Promise.all` (or a batched equivalent) so mission task-fetching runs in parallel.
- Live-verified: measure real load time before/after with the current real mission count, report the numbers.
- `getSystemStats()` (same file, same pattern, currently dead/orphaned per the audit) — fix it too while in this function, or explicitly note it's being left as-is since nothing calls it.

---

## Not part of this milestone (queued separately)
- Fake `systemStore` health/events data (top-nav CPU/MEM, `/notifications` seed events).
- Delegation visibility (`activeWorker` state with no UI consumer).
- Dead-code cleanup (`.claude/_refrepo`, `ChatDock`, `VoiceDock`).
- Dead buttons/commands (Chat "Regenerate", attachment button, "Toggle Voice Dock").

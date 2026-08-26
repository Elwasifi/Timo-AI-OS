# Milestone 3 — Speed & Stability + Visual/UX Fixes Backlog

> **MILESTONE 3 FULLY CLOSED 2026-08-27 — all 12 tickets (M3-01, M3-02, M3-03, M3-04, M3-05, M3-06, M3-07, M3-08, M3-09, M3-10, M3-11) reviewed, approved, and merged to `main`.** No tickets remain open in this milestone.
> Owner: Claude Cowork (Technical Manager). Implemented by: Claude Code (local). Status values: `Open` → `In Progress` → `Pushed for Review` → `Reviewed — ready to merge` → `Merged`.
> Branches: `milestone-3-experience` (M3-01/02/04/05) and `milestone-3b-voice-fixes` (M3-07 through M3-11, M3-03, M3-06) — both merged to `main` via clean fast-forwards, no conflicts.

---

## M3-01 — Diagnose and fix chat latency / silent non-response
**Priority:** Critical
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-01" section for the full root-cause trace and fix.

**Problem** (found by direct code inspection, not just the user's report): `lib/ai/ai-provider.ts`'s `chatWithFallback()`/`streamWithFallback()` walk up to 5 providers (Gemini→Groq→NVIDIA→OpenRouter→Ollama), and for EACH one that fails, retry 3 times with exponential backoff (1s, 2s, 4s) before moving to the next provider. If one provider near the front of the chain has a stale/dead free-tier model name (already flagged as a known live issue in `docs/GOVERNANCE.md` — "stale model names 404ing"), a single chat message can wait 30+ seconds, or fail entirely if Ollama isn't running locally, before the user sees anything.

Also to confirm: `lib/crew/ai-intent-analyzer.ts` calls `chatWithFallback()` — a full separate LLM round-trip with its own retry/fallback exposure. Determine whether this runs synchronously in the critical path of every chat message (not just specific routing flows) — if so, this doubles the latency/failure exposure per message.

**Acceptance criteria:**
- Audit `lib/ai/router/modelCatalog.ts` and every provider's configured model name against each free-tier API's actual current model list; fix any stale/404ing model names.
- A provider already marked unhealthy by the existing health-tracking (`lib/ai/router/healthTracker.ts`) should be skipped immediately, not retried 3x with backoff, on the next call within its cooldown window.
- Determine whether ai-intent-analyzer's LLM call sits in the synchronous hot path for every message; if it does, either make it a fast/cheap-model call with a short hard timeout, or move it off the critical path (run in parallel with the main response, not before it) — document the decision.
- Live-verified: send 10 real chat messages back-to-back with the current free-tier setup and record actual response latency for each (first token / first content, not full completion) — report the before/after numbers.
- Fix or clearly document the "sometimes doesn't respond at all" case — if it was a silently-swallowed error, it must now surface a real user-facing error message, never a silent hang.

## M3-02 — Fast-first-response guarantee
**Priority:** Critical
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-02" section.

**Acceptance criteria:**
- A plain question (no tool/mission execution needed) gets a visible first response within a defined, tested budget — target under 5 seconds on a healthy provider — even though a multi-step mission naturally takes longer after that.
- For any request that triggers tool/mission execution, the user sees an immediate acknowledgment ("received, working on it" or equivalent) before the execution itself completes, not silence until the full result is ready.
- Live-verified with real messages of both kinds (plain question vs. one that triggers a real tool/mission), timestamps recorded.

## M3-04 — Rename Command Deck to Main Dashboard; fix the G-Brain mini-view link
**Priority:** High
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-04" section. Landed in the same commit as M3-05 (both touch `components/temo/command-deck.tsx`).

- Rename "Command Deck" to "Main Dashboard" everywhere it appears (page titles, `LeftNav.NAV_ITEMS`, any other UI string) — pure rename, no functional change beyond what's described below.
- In `components/temo/command-deck.tsx` (~line 361-366), the hero-bridge section's caption block currently reads "LIVE COMMAND BRIDGE /// NEURAL SYNCHRONIZATION" — remove this text entirely. Replace it with a small, visually distinct "G-Brain" button/link (styled consistently with the existing cinematic design system) that navigates to the full G-Brain page (`/`). The hero-bridge section itself (the live mini team view) stays as-is — it's now framed as a preview of G-Brain, with this button being the obvious way to go see the full version.
- Live-verified: click the new button from Main Dashboard, confirm it lands on the real G-Brain page with the live data intact.

## M3-05 — Voice trigger redesign + fix the chat-page mic bug
**Priority:** High
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-05" section.

**Confirmed bug:** `app/chat/page.tsx` (~line 596) wires InputBar's `onVoiceToggle` to `() => router.push('/settings')` — the mic button next to the send button currently redirects to Settings instead of activating voice input.

**Scope:** visual/interaction redesign only — do NOT change the underlying voice engine (stays the free browser Web Speech API; STT/TTS quality itself is out of scope).

**Acceptance criteria:**
- Fix the chat-page mic button: `onVoiceToggle` must actually start/stop real voice listening (the existing VoiceManager/voice-recorder machinery), never navigate away from the page.
- On the home/G-Brain page: replace the current "Tap to Speak" control (today a button containing several unlabeled sub-buttons — mic-on, mic-off, open-chat) with a single clean mic-icon button positioned directly under Temo.
- On click, this button transforms into a professional recording-bar UI with listening-state lighting/motion (inspired by ChatGPT's voice mode interaction pattern, but using this app's own existing visual language — colors, glow, animation style already established in G-Brain/Command Deck — not a copied look).
- Live-verified: the redesigned control actually starts/stops the same underlying voice session as before (no regression to voice functionality itself, purely how it's triggered and how it looks).

---

## M3-07 — Fix "No agent selected" voice error on Main Dashboard
**Priority:** Critical
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-07" section.

**Root cause found by direct code inspection**: `VoiceTrigger` (`components/temo/command-deck.tsx`, added in M3-05) calls `voiceManager`, whose `getActiveAgent()` (`lib/voice/voice-manager.ts` ~line 48-51) reads the agent list from the shared `useDashboardStore`. But `command-deck.tsx` loads its own agent list into local component state via `loadAgents()` imported directly from `lib/agents/agentRegistryService` (~line 385) — it never populates `useDashboardStore`. If a user opens Main Dashboard directly (without first visiting a page that populates that store, like `/chat`), `voiceManager` finds no agent for the default `activeAgentId` (`'temo'`) and `crew-coordinator.ts`'s `generateResponse()` throws "No agent selected" (confirmed at 3 call sites, ~lines 402/445/492) — spoken back via TTS, exactly what the user heard.

**Acceptance criteria:**
- Main Dashboard must populate the same shared `useDashboardStore` (reuse its existing `loadAgents` store action, the same one `app/chat/page.tsx` already uses) instead of — or in addition to — its own local state, so voice works correctly regardless of which page the user starts on.
- Live-verified: open Main Dashboard as the very first page of a fresh session (no prior page visited), use the voice trigger, confirm Temo responds correctly with no "No agent selected" error.
- Confirm the existing Main Dashboard agent-list rendering (org chart, Corporate Office bands, etc.) still works exactly as before — this is a store-population fix, not a rendering change.

## M3-08 — Investigate the mission that stalled at 20%
**Priority:** Critical
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-08" section for the full root-cause trace.

A voice-triggered mission started, was correctly created and visible in the Missions page, progressed to 20%, then stopped with no further progress and no error surfaced anywhere.

**Acceptance criteria:**
- Investigate the actual state in the database (`mission_tasks` status/`locked_at`, `mission_timeline` events) for the specific mission, not just the UI. Determine whether this is: (a) the already-known limitation that the background task queue exists but has no `pg_cron` schedule yet (`docs/TEMO-ARCHITECTURE.md`, "PARTIAL (V1)"), meaning only the first synchronously-executed task ran and the rest sit in `'ready'` state waiting for a scheduler that doesn't exist in local dev, or (b) a new bug — e.g. M3-01's provider health-skip logic (`lib/ai/ai-provider.ts`'s `isSkippableUnhealthy()`) causing a task's AI call to fail silently without marking the task itself as failed/retryable.
- Root cause identified and documented, not guessed.
- If (a): the mission's current state must at minimum surface an honest "still in progress, waiting on task processing" status to the user instead of silently going quiet at 20% — never a fabricated "complete" and never unexplained silence.
- If (b): fix the actual bug.
- Live-verified with a new real mission triggered the same way (voice, on Main Dashboard).

## M3-09 — Remove the old floating voice control from all remaining pages
**Priority:** High
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-09" section.

`top-nav.tsx`'s `VoiceHud` suppression only covers `/` and `/dashboard` (~line 19-20's `isDashboard` check). Every other page (`/chat`, `/missions`, `/agents`, `/settings`, etc.) still renders the old floating voice orb with its unlabeled sub-buttons — the exact control M3-05 was supposed to replace everywhere, not just on 2 pages.

**Acceptance criteria:**
- `VoiceHud` is removed from every page except where a page has its own dedicated, purpose-built voice control (Main Dashboard's `VoiceTrigger`, and Chat's mic button next to Send — both already exist).
- Pages with no voice control of their own (Missions, Agents, Settings, etc.) — decide and document one consistent approach: either no voice entry point on those pages at all (voice is a Main-Dashboard/Chat feature), or a minimal consistent trigger reusing the same visual language as `VoiceTrigger`. Do not leave the old unlabeled-sub-buttons version anywhere.
- Live-verified by visiting every page in the app and confirming no old voice control remains.

## M3-10 — Bring Chat page's voice mic to visual parity with Main Dashboard
**Priority:** High
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-10" section.

The chat page's mic button (fixed in M3-05 to actually start/stop listening) has no visual feedback at all — no listening indicator, no waveform, no sign it heard anything, and the user reported it sometimes produces no response with no explanation. Main Dashboard's `VoiceTrigger` component already has the right UX (listening animation, waveform, transcript-in-progress, status label) — reuse it, don't rebuild a second version.

**Acceptance criteria:**
- Chat page's mic control shows the same listening/thinking/speaking states and waveform as Main Dashboard's `VoiceTrigger` (extract it to a shared component if it isn't already reusable).
- Any voice request that fails (recognition error, empty transcript, AI call failure) shows a real, visible error state in the chat UI — never silent nothing.
- Live-verified: speak a message in Chat, confirm the same visual feedback quality as Main Dashboard, including a visible error state when something is deliberately made to fail (e.g. denying mic permission).

## M3-11 — Fix Settings → Voice page to reflect the real engine
**Priority:** Medium
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-11" section.

The Voice settings page currently shows "Engine: Gemini Live API" (single fixed option) and "Voice: Microsoft David - English (United States)" — neither reflects the actual implementation, which is the browser's free Web Speech API (`services/voiceService.ts`). This is exactly the kind of fabricated-looking UI this project's own principles explicitly reject (CLAUDE.md rule 7: "never introduce mock/placeholder implementations disguised as real functionality").

**Acceptance criteria:**
- Engine field reflects reality (Web Speech API / browser-provided), not a fictional "Gemini Live API" option.
- Voice dropdown is populated from the real available voices on the user's own browser (`voiceManager.getAvailableVoices()` / `player.getVoices()`), not a single hardcoded name.
- Add a "test/preview" button that speaks a short sample using the currently selected voice/speed/pitch — so a user can actually hear before committing.
- The selected voice must actually be applied to real TTS output, not just stored and ignored.
- Live-verified: change the voice selection, hit test/preview, hear the actual different voice; confirm the same voice is then used in a real chat/voice interaction.

---

## M3-03 — G-Brain radial layout redesign
**Priority:** High (previously queued, not yet started)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-03" section.

Timo centered/large, Corporate Office ring, Operating Company ring, worker ring, size decreasing by depth, hover-card with full agent details.

**New input from live testing**: the current mini G-Brain preview on Main Dashboard is visibly too tall / has too much empty vertical space (screenshots provided by Amro showing a long vertical tree with large gaps) — factor this into the radial redesign: a circular layout centered on Temo should be inherently more compact vertically than the current top-to-bottom tree, but explicitly verify the mini-preview's aspect ratio/whitespace as part of this ticket's acceptance criteria, not just the full G-Brain page.

## M3-06 — Timo persona/system-prompt pass
**Priority:** Medium (previously queued, not yet started)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-27. See `docs/TEMO-ARCHITECTURE.md`'s dated "M3-06" section.

Punchier, more natural Egyptian-Arabic TEXT responses (independent of voice), less "generic AI," more decisive tone.

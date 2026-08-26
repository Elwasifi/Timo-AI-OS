# Milestone 3 — Speed & Stability + Visual/UX Fixes Backlog

> Owner: Claude Cowork (Technical Manager). Implemented by: Claude Code (local). Status values: `Open` → `In Progress` → `Pushed for Review` → `Reviewed — ready to merge` → `Merged`.
> Branch: `milestone-3-experience`, checked out locally for the whole milestone, one commit per ticket pushed immediately after each is done and live-verified, per `docs/GOVERNANCE.md`'s branching model.
> Sequencing: M3-01 and M3-02 first (same root problem — provider retry/fallback tuning plus first-response guarantees, the true blocker for any beta user). M3-04 and M3-05 after, in either order.
> **Explicitly out of scope for this milestone (queued separately): M3-03 (G-Brain radial layout redesign), M3-06 (Timo persona/system-prompt pass).**

---

## M3-01 — Diagnose and fix chat latency / silent non-response
**Priority:** Critical
**Status:** Open

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
**Status:** Open

**Acceptance criteria:**
- A plain question (no tool/mission execution needed) gets a visible first response within a defined, tested budget — target under 5 seconds on a healthy provider — even though a multi-step mission naturally takes longer after that.
- For any request that triggers tool/mission execution, the user sees an immediate acknowledgment ("received, working on it" or equivalent) before the execution itself completes, not silence until the full result is ready.
- Live-verified with real messages of both kinds (plain question vs. one that triggers a real tool/mission), timestamps recorded.

## M3-04 — Rename Command Deck to Main Dashboard; fix the G-Brain mini-view link
**Priority:** High
**Status:** Open

- Rename "Command Deck" to "Main Dashboard" everywhere it appears (page titles, `LeftNav.NAV_ITEMS`, any other UI string) — pure rename, no functional change beyond what's described below.
- In `components/temo/command-deck.tsx` (~line 361-366), the hero-bridge section's caption block currently reads "LIVE COMMAND BRIDGE /// NEURAL SYNCHRONIZATION" — remove this text entirely. Replace it with a small, visually distinct "G-Brain" button/link (styled consistently with the existing cinematic design system) that navigates to the full G-Brain page (`/`). The hero-bridge section itself (the live mini team view) stays as-is — it's now framed as a preview of G-Brain, with this button being the obvious way to go see the full version.
- Live-verified: click the new button from Main Dashboard, confirm it lands on the real G-Brain page with the live data intact.

## M3-05 — Voice trigger redesign + fix the chat-page mic bug
**Priority:** High
**Status:** Open

**Confirmed bug:** `app/chat/page.tsx` (~line 596) wires InputBar's `onVoiceToggle` to `() => router.push('/settings')` — the mic button next to the send button currently redirects to Settings instead of activating voice input.

**Scope:** visual/interaction redesign only — do NOT change the underlying voice engine (stays the free browser Web Speech API; STT/TTS quality itself is out of scope).

**Acceptance criteria:**
- Fix the chat-page mic button: `onVoiceToggle` must actually start/stop real voice listening (the existing VoiceManager/voice-recorder machinery), never navigate away from the page.
- On the home/G-Brain page: replace the current "Tap to Speak" control (today a button containing several unlabeled sub-buttons — mic-on, mic-off, open-chat) with a single clean mic-icon button positioned directly under Temo.
- On click, this button transforms into a professional recording-bar UI with listening-state lighting/motion (inspired by ChatGPT's voice mode interaction pattern, but using this app's own existing visual language — colors, glow, animation style already established in G-Brain/Command Deck — not a copied look).
- Live-verified: the redesigned control actually starts/stops the same underlying voice session as before (no regression to voice functionality itself, purely how it's triggered and how it looks).

---

## Not part of this milestone (queued separately)
- **M3-03** — G-Brain radial layout redesign.
- **M3-06** — Timo persona / system-prompt pass.

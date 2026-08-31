# Milestone 5 — Security, Correctness & Governance Backlog

> Owner: Amro. Implemented by: Claude Code (local). Status values: `Open` → `In Progress` → `Pushed for Review` → `Reviewed — ready to merge` → `Merged`.
> Source: the Deep Integrity Audit (2026-08-29) — the audit's own report is not duplicated here, only the resulting tickets.
> Two-stage milestone. Stage 1 (below): security containment + behavior correctness, branch `milestone-5-stage1-security-correctness`. Stage 2 (further below): governance / capability-contract gap, branch `milestone-5-stage2-governance`. Both merged to `main` — Stage 1 at `2bab101`, Stage 2 at `b8d74fa`.

---

## SECURITY

## S0-01 — Rotate all 5 exposed provider API keys
**Priority:** Critical
**Status:** Done (owner action, not a code change). Gemini, OpenRouter, Groq, NVIDIA, and n8n keys rotated by Amro directly against each provider's dashboard; new values written to `app_settings` on 2026-08-30 and verified via hash comparison against the live DB row (no plaintext ever logged).

The anon key could read these in plaintext from `app_settings` before S0-03 closed the hole (Deep Integrity Audit, Section H1-b) — the old values were treated as compromised regardless of the RLS fix, since a key already read once can't be un-read.

## S0-02 — Fix tenant_members's unconstrained self-insert policy
**Priority:** Critical
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`tenant_members_insert_self` only checked `user_id = auth.uid()`, no `tenant_id` constraint — any authenticated user could self-assign as owner of any tenant, including the internal Temo Corporate tenant, defeating every `is_tenant_member()` check downstream (including the M1-06/M2-01 IDOR fixes).

**Acceptance criteria:**
- Self-insert constrained to a server-verified tenant/invite flow, or removed if no legitimate client-side write path exists.
- Live-verified: a direct escalation attempt against the live DB is rejected, and the internal tenant's real membership is unaffected.

## S0-03 — Fix anon-readable RLS on app_settings/conversations/messages
**Priority:** Critical
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

Live `pg_policies` had drifted from the migration chain's intent — permissive `anon_*` policies from before the V1 multi-tenant migration still coexisted with newer `authenticated`-only policies (RLS policies are OR'd, so the old permissive one alone was enough to expose every row). Verified directly against live `pg_policies`, not the migration files, per the audit's own finding that they'd drifted.

**Acceptance criteria:**
- Every existing policy on the affected tables dropped unconditionally and recreated from a clean slate matching the migration chain's original intent.
- Live-verified: real anon-key HTTP probes against each table return `Content-Range: */0` (RLS-blocked, not empty tables).

## S0-04 — Remove anon DELETE on fact_revisions and anon UPDATE on memory_settings
**Priority:** High
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`fact_revisions` (a write-only audit log) had an anon DELETE policy; `memory_settings` (global embedding/provider config) had an anon UPDATE policy. Neither was in the V1 migration's tightening list.

**Acceptance criteria:**
- Both tables locked to `authenticated` only.
- Live-verified alongside S0-03's anon-key probes.

## S0-05 — Gate DELETE /api/agents/registry/[id] behind approval_requests
**Priority:** High
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`agent_registry` is global across every tenant by design — a hard delete removes an agent for every tenant, not just the caller's own. `requireUser()` alone only proved the caller was signed in as *some* user, not that they should be allowed to take a destructive, cross-tenant action.

**Acceptance criteria:**
- DELETE creates a pending `approval_requests` row (visible in the existing Settings → Approvals UI) instead of executing immediately, and only proceeds once approved.
- Live-verified end to end: created a disposable test agent, confirmed delete was blocked and a real pending approval appeared, approved it, confirmed delete then succeeded. Redesigned mid-flight after live testing surfaced a real gap — the first version relied on client-held approval-id state that didn't survive a reload; replaced with a server-authoritative lookup.

---

## CORRECTNESS

## M5-01 — Fix the two intent-classification bugs
**Priority:** High
**Status:** Merged (main@2bab101). Live-verified twice — once at initial implementation, once more at explicit request after a suspected browser-automation network issue. See `docs/TEMO-ARCHITECTURE.md`.

(a) `lib/context/intent-detector.ts`'s `MEMORY_QUERY_PATTERNS` had an unbounded catch-all (`/\b(what|who) (is|are) .*\b/i`) matching almost any "what is X" sentence, including pure general-knowledge questions, short-circuiting them to "I couldn't find this in your memory" instead of ever reaching the LLM.
(b) `lib/swarm/decisionEngine.ts`'s mission-verb scoring ran with zero awareness that "remember" statements exist, so one containing mission-sounding words could get hijacked into a mission before `memory-decision.ts`'s deterministic "remember" rule ever ran.

**Acceptance criteria:**
- (a) narrowed to require a possessive ("my"/"our"), verified against every existing validated case in `lib/validation/tests.ts`.
- (b) an explicit remember statement always forces the 'simple' pipeline regardless of mission-verb score, reusing `intent-detector.ts`'s own `asksToRememberInput()` rather than a second, independent definition.
- Live-verified via the real chat UI both times: (a) confirmed via console log showing the request reaching a real provider call instead of the instant short-circuit; (b) confirmed via a live DB query showing the statement stored as a real memory row, with no new mission created.

## M5-02 — Fix the fake-success bug in Atlas's research task
**Priority:** High
**Status:** Merged (main@2bab101, plus a follow-up doc-comment commit). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

A task could reach `status: completed` with `result.output` being literally the tool call's own request arguments (e.g. `{"query":"...", "max_results":10}`), not a real answer — same class of bug as M1-04/M4-01/M4-02, recurring in a new place.

**Acceptance criteria:**
- A structural guard (`looksLikeRealAnswer()`) verifies a task's output actually reads as an answer before it's accepted, not a one-off patch for this specific task.
- Live-verified end to end by re-triggering the exact mission that originally exhibited the bug — the research task now correctly resolves `status:'failed'` after 3 honest retries instead of a fake `'completed'`. First guard version only checked whether the whole string parsed as one JSON value, which missed the actual live failure shape (two JSON objects concatenated across lines) — caught and fixed after re-verification, then confirmed against the exact captured degenerate output.
- Documented known limitation added on request: rejects any entirely-valid-JSON output regardless of intent — correct today (no task legitimately returns structured JSON), noted so it isn't rediscovered as a surprise if that changes.

## M5-03 — Fix runtime_state's cross-mission race
**Priority:** Medium
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`runtime_state` is a single-row global singleton shared by every concurrently running mission, updated via a plain unconditional UPDATE — two missions racing could each write mission-specific fields, and whichever committed last silently won regardless of which mission was actually still running.

**Acceptance criteria:**
- `updateRuntimeState()` takes an optional `expectedMissionId` optimistic-lock precondition; the final post-execution write passes its own mission id.
- Live-verified against the real DB: a simulated stale write from a superseded mission correctly returned null and left the newer mission's state untouched.

## M5-04 — Add an idempotency guard to recalculateProgress()
**Priority:** Medium
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`recalculateProgress()` is a non-atomic read-modify-write; two tasks completing near-simultaneously via different execution paths could both observe the mission as not-yet-terminal and both fire `recordMissionCompleted`/`recordLesson` for the same transition.

**Acceptance criteria:**
- An atomic conditional claim (`claimMissionTerminalStatus()`) gates the terminal transition; only the winning caller runs the completion/failure side effects.
- Live-verified against the real DB: two concurrent claims for the same mission — exactly one succeeded.

## M5-05 — Delete the redundant, incorrect-formula progress write
**Priority:** Low
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`executionLayer.ts` wrote `mission.progress` twice per task-completion iteration — once with an incorrect formula (ignoring failed tasks), immediately overwritten by `recalculateProgress()`'s correct one.

**Acceptance criteria:**
- Redundant write removed.
- Live-verified: a fresh mission's final progress still lands correctly with the write gone.

## M5-06 — Delete the dead legacy AgentSelector routing path
**Priority:** Low
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`lib/crew/agent-selector.ts` used a hardcoded keyword map as a second, independent agent-routing mechanism alongside the current registry-driven `capabilityMatcher.ts`. Its only consumer (`crewManager.route()`) had zero callers anywhere in the codebase.

**Acceptance criteria:**
- Dead file deleted, `crew-manager.ts`'s unused `selector`/`route()` removed.
- Live-verified: `/agents` (the one real remaining `crewManager` consumer) loads with no page errors.

## M5-07 — Fix dashboardStore's loadAgents() empty catch block
**Priority:** Low
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

Same pattern M4-06 already fixed in the sibling `loadMissions()` in the same file — a query failure was silently swallowed with zero user-facing signal.

**Acceptance criteria:**
- New `loadAgentsOrThrow()` sibling in `agentRegistryService.ts` (mirroring M4-06's `listMissionsOrThrow()`), used only by the store action; the widely-relied-on fallback contract of the original `loadAgents()` stays untouched for its other callers.
- Live-verified: forced a 500 on `agent_registry` — the dashboard renders with no page errors, confirming graceful degradation.

## M5-08 — Add the 5 missing agents to the static AGENT_DEFINITIONS fallback
**Priority:** Medium
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

vertex/forge/sentinel/cortex/ledger were missing from the static fallback array entirely — if `loadAgents()` ever fell back (DB unreachable/empty), these 5 agents would silently vanish system-wide.

**Acceptance criteria:**
- All 5 entries added, mirroring the live `agent_registry` seed rows exactly; `temo.childrenIds` fixed to match (was already stale, missing `orion` too).
- Live-verified: forced a 500 on `agent_registry` and loaded G-Brain — Vertex/Forge/Ledger render correctly from the fallback with zero page errors.

## M5-09 — Remove the dead roleId field
**Priority:** Low
**Status:** Merged (main@2bab101). Live-verified. See `docs/TEMO-ARCHITECTURE.md`.

`agentRegistryService.ts`'s `mapAgentRow()` read `row.role_id ?? row.id`, but no migration ever creates a `role_id` column — it always silently equaled `id`.

**Acceptance criteria:**
- Field removed from `AgentRecord` and every population site (`mapAgentRow()`, all 15 `AGENT_DEFINITIONS` entries, the legacy `Agent.roleId` bridge functions that sourced from the same dead data).
- Every direct consumer switched to `.id` directly; `resolveRoleId()` simplified rather than removed, so its callers are unaffected.
- Live-verified end to end via the worker-delegation path specifically (the code most touched by this refactor) — 5 of 6 tasks completed with real content, zero page errors.

---

# Milestone 5, Stage 2 — Governance Backlog

> Branch: `milestone-5-stage2-governance`, off `main` at Stage 1's merge (`2bab101`). One commit per ticket, live-verified. Merged to `main` at `b8d74fa`.
> Source: the Deep Integrity Audit (2026-08-29), Sections B/J — the capability-contract gap (agents shipped with no tool permissions) and the tenant-isolation gap in the Knowledge Engine / runtime tables.

## M5-10 — Add AGENT_PERMISSIONS entries for the 9 tool-dead agents
**Priority:** High
**Status:** Merged (main@b8d74fa). See `lib/tools/types.ts`.

vertex, forge, sentinel, cortex, ledger, orion, nova-frontend, nova-backend, and nova-qa were all active in `agent_registry` with zero entries in `AGENT_PERMISSIONS` — `permissionEngine.validate()` throws for any agent with no entry at all, so all 9 were structurally unable to execute any tool.

**Acceptance criteria:**
- Each new entry independently scoped to what that role actually needs (not copy-pasted from a neighbor), with a reasoning comment per entry.
- Nova's 3 workers get their own entries, not an inherited/aliased copy of Nova's.

## M5-11 — Fix delegated-work permission gating to check the worker's own id
**Priority:** High
**Status:** Merged (main@b8d74fa). See `lib/swarm/executionLayer.ts`, `lib/crew/crew-coordinator.ts`, `lib/context/context-manager.ts`.

`executionLayer.ts:189` and `crew-coordinator.ts:281` always passed the *manager's* id to `permissionEngine.getPermissions()`/`decideTools()`, even for a task actually executed by a delegated worker — meaning M5-10's per-worker scoping would never actually have been checked.

**Acceptance criteria:**
- `executionLayer.ts`: uses the already-resolved `workerId` (from `findWorkerForTask()`) ahead of the manager id.
- `crew-coordinator.ts`: pre-resolves the likely worker via `selectWorkerForManager()` before the tool-decision gate runs (that pipeline normally resolves the worker later, inside `delegateManagerTask`), passed through a new optional `toolDecisionAgentId` parameter on `runContextManager()` — memory/context-building attribution deliberately still uses the routed manager, unchanged.
- Live-verified: direct `permissionEngine.validate()` checks for nova/nova-frontend/nova-backend/nova-qa across their real tool categories, confirming the previous behavior (manager's permissions leaking to worker calls) and the fix, without regressing any currently-working delegated task.

## M5-12 — Build-time check for agents missing a permissions entry
**Priority:** Medium
**Status:** Merged (main@b8d74fa). See `tests/agent-permissions.test.ts`, `package.json`'s `prebuild` script.

This exact gap (an active agent shipped with no `AGENT_PERMISSIONS` entry) recurred 3 times (Orion, the 5 Corporate Office agents, structurally for all workers) before M5-10 closed it.

**Acceptance criteria:**
- A real integration test against the live `agent_registry` fails with the specific missing agent id(s) named, if any active row has no matching entry.
- Wired into `npm run build` via `prebuild`, so a future gap fails the build rather than shipping silently.
- Live-verified: temporarily removed one entry, confirmed the test failed naming that exact agent, restored it, confirmed 10/10 passing again.

## M5-13 — Tenant-scope structured_facts, fact_revisions, memory_events, runtime_activity
**Priority:** Critical
**Status:** Merged (main@b8d74fa). Live-verified in both directions. See the two migrations dated 2026-08-30/31 and `docs/TEMO-ARCHITECTURE.md`.

None of these 4 tables had any tenant scoping — cross-tenant data leakage by construction (Deep Integrity Audit, Section H1-e).

**Acceptance criteria:**
- Real `tenant_id` columns added and actually wired through RLS, the 4 `SECURITY DEFINER` RPC functions that bypass RLS entirely, and the app-code call sites that already had `tenantId` in scope but never passed it through.
- `structured_facts`'s global `(subject, predicate)` unique index replaced with a tenant-scoped one in the same migration that adds the column.
- `runtime_activity`'s `tenant_id` derived via a `BEFORE INSERT` trigger from its existing `mission_id` column, rather than threading `tenantId` through ~21 `emitRuntimeEvent()` call sites.
- `runtime_state` explicitly documented (via `COMMENT ON TABLE`) as deliberately NOT scoped — a single-row global singleton can't express per-tenant state via a column; real isolation would need an architectural redesign, already flagged out of scope in Stage 1.
- A first-pass tenant-membership check on the 4 RPC functions (`is_tenant_member(p_tenant_id)`) was caught live, immediately after the first push, to unconditionally reject the app's own real server-side calls (service-role client has no `auth.uid()`). Corrected in a same-day follow-up migration to skip the check for `auth.role() = 'service_role'` (already gated upstream at the API route layer per this project's V1 security posture) while still enforcing it for a real authenticated browser session.
- Live-verified: dry-run in `BEGIN`/`ROLLBACK` before each of the two pushes; `tenant_id` backfill confirmed populated with 0 unexpected nulls; both RPC auth-gate directions confirmed against the live DB using the app's real service-role client (succeeds) and a real throwaway authenticated non-member user spoofing a foreign `tenant_id` (still rejected); typecheck clean; full test suite (10/10) passing.

---

## Not part of either stage
- Everything else the Deep Integrity Audit flagged as Medium priority or lower and not listed above.

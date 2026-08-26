# Temo AI OS — Architecture Reference

This document is the architectural source of truth for the Timo-AI-OS repository. It reflects the state of the codebase as verified by a full technical audit, not aspirational design. Every claim below is grounded in the actual code, not assumptions about what "should" exist.

---

## 1. PROJECT OVERVIEW

**Vision.** Temo AI OS began as a personal AI operating system: a single chief agent ("Temo") backed by a small hierarchy of manager and worker agents, capable of chatting, executing missions, remembering context, and calling tools/workflows on the user's behalf.

**Current purpose.** Today the system is a single-user, single-tenant Next.js + Supabase application. A user talks to Temo (via chat or voice), the system decides whether the request is simple (answer directly) or complex (spin up a multi-step "mission"), and either a direct LLM response or a sequence of manager/worker task executions is produced. Results, timelines, and events are persisted to Supabase and surfaced on dashboard pages.

**Target evolution.** The project is evolving into a **Corporate AI Operating System** — Temo as CEO of a private AI business group, presiding over a Corporate Office (Strategy, R&D, Quality/Audit, Finance/Governance, Workforce Management), which in turn oversees multiple independent **companies**, each with its own departments, managers, and a **shared** AI workforce dynamically assigned across missions. Eventually this extends to a client-facing AI Agency with multi-tenant isolation, per-client AI Account Managers, billing, and freemium packages. None of the multi-company, multi-tenant, or client-facing layers exist yet — see Sections 8 and 9.

---

## 2. CURRENT ARCHITECTURE

| Layer | Implementation | Notes |
|---|---|---|
| **Frontend** | Next.js 13 (pages router under `app/`), React 18, Tailwind, Zustand stores, Radix UI | Pages: chat, missions, agents, memory, knowledge, tools, workflows, analytics, dashboard, settings, validation, notifications |
| **Backend** | Next.js API routes (`app/api/**`) — thin, mostly read-only GET wrappers around service modules in `lib/` | No mutation endpoints for missions/tasks; missions are only created indirectly via `orchestrate()` |
| **Supabase/Postgres** | Tables for agents, departments, missions/objectives/tasks, timeline, runtime state/activity, memories, memory_embeddings (pgvector), structured_facts, memory_links, conversations, app_settings, workflow_registry | RLS enabled but policies grant full CRUD to `anon, authenticated` — explicitly documented in migrations as "single-tenant, no-auth app" |
| **AI provider layer** | `lib/ai/ai-provider.ts` → Supabase Edge Function `ai-chat` → real HTTP calls to Gemini, Groq, NVIDIA NIM, OpenRouter, Ollama | Client-side fallback/retry logic is real; no OpenAI/Anthropic wiring despite legacy DB columns |
| **Memory/RAG** | `lib/memory/*` + `lib/knowledge/engine.ts`, pgvector via edge function `embeddings` | Real semantic search; extraction is regex-based, not LLM-based |
| **Mission Engine** | `lib/swarm/missionEngine.ts`, `missionPlanner.ts`, `missionService.ts`, `swarmManager.ts`, `executionLayer.ts`, `capabilityMatcher.ts`, `workerRouter.ts`, `decisionEngine.ts`, `unifiedOrchestrator.ts` | Real Supabase-backed lifecycle; execution is synchronous/sequential, in-request |
| **Agent/Department system** | `lib/agents/*` (hardcoded definitions + DB read layer), `lib/crew/*` (parallel in-memory registry/router) | Two parallel registries — see Section 3 and 8 |
| **Tool Engine** | `lib/tools/registry.ts`, `executor.ts`, `chain.ts`, `planner.ts`, `permissions.ts`, `builtin-tools.ts` | Core engine real; many individual tools (Gmail, Drive, Calendar, GitHub, files, web search) are placeholders |
| **n8n integration** | `services/n8n/*`, Supabase Edge Function `n8n-proxy` | Real, webhook-based triggering, credential proxying, registry sync |
| **Runtime/Event system** | `lib/swarm/runtimeStore.ts`, `app/api/stream/mission`, `app/api/stream/runtime` | Real, but polling-based SSE (1.5–2s interval), not push/pubsub |
| **Voice layer** | `lib/voice/voice-recorder.ts`, `voice-player.ts`, `voice-manager.ts`, `speech-cleaner.ts` | Browser Web Speech API only (no cloud STT/TTS provider); routes transcripts through the same `orchestrate()` pipeline as text chat |

---

## 3. CURRENT AGENT ORGANIZATION

### Hierarchy as implemented

```
Temo (chief)
 ├── Nova   (manager, Engineering)   → nova-frontend, nova-backend, nova-qa (workers)
 ├── Flow   (manager)                → no workers wired
 ├── Atlas  (manager)                → no workers wired
 ├── Luna   (manager)                → no workers wired
 ├── Echo   (manager)                → no workers wired
 └── Orion  (manager, seeded inactive)
```

- **Temo / CEO** — the chief agent (`level: 'chief'`), the conceptual top of the hierarchy. Currently there is no distinct "CEO orchestration" logic separate from the `unifiedOrchestrator` decision flow — Temo is a data record and a persona for LLM prompting, not a separate execution layer.
- **Managers** — 6 defined (`Nova`, `Flow`, `Atlas`, `Luna`, `Echo`, `Orion`). Only **Nova** has real, working delegation logic to workers (`lib/crew/nova-delegation.ts`). The other 5 have empty `childrenIds` in both the static definitions and the DB seed — they execute tasks themselves rather than delegating.
- **Workers** — 3 defined, all under Nova (`nova-frontend`, `nova-backend`, `nova-qa`). No workers exist for any other department.

### Hardcoded/static vs. dynamic/DB-backed

| Component | Static (compiled-in) | DB-backed |
|---|---|---|
| Agent definitions | `lib/agents/definitions.ts` — 9 agents, fixed array | `agent_registry` table exists with matching schema (incl. `parent_id`, `children_ids`, `priority`, `tools`) |
| Departments | `lib/agents/departments.ts` — 6 fixed departments | `agent_departments` table exists |
| Registry read path | — | `lib/agents/agentRegistryService.ts` reads DB, falls back silently to the static arrays on any error or empty result |
| Registry write path | **Added in Sprint 1** | `createAgent`/`updateAgent`/`createDepartment`/`updateDepartment` in `lib/agents/agentRegistryService.ts` — real Supabase inserts/updates against the existing schema (no migration needed) |
| Second, separate registry | `lib/crew/agent-registry.ts` — in-memory `Map`, populated by whichever `Agent[]` a caller passes to `register()`/`registerAll()` | **No longer authoritative (Sprint 1).** It gained a `mergeFromRegistry()` method that hydrates already-registered agents with hierarchy metadata from the unified registry, but its callers (`crew-coordinator.ts`, `crew-manager.ts`) have not yet been rewired to invoke it — see Sprint 1 status below |
| API routes (`/api/agents/departments|managers|registry`) | **Migrated in Sprint 1** — now call `lib/agents/agentRegistryService.ts` directly (`loadDepartmentsWithAgents`, `getManagers`, `loadAgents`, `getChief`) | No longer route through `lib/dashboard/dashboardService.ts`'s static data |

**Bottom line:** `lib/agents/agentRegistryService.ts` is now the single canonical registry service, with both read and write paths, and is what the three registry API routes serve. The org chart itself is still the same 9 agents / 6 departments (no new agents/departments were added — out of Sprint 1 scope), and `lib/crew`'s in-memory routing cache still needs to be wired to consume the unified registry in a follow-up sprint (see below).

### Sprint 1 — Unified Registry (Completed)

**Objective:** make `lib/agents/agentRegistryService.ts` the single source of truth for agents/departments, without rebuilding the orchestration system.

**Files changed:**
- `lib/agents/agentRegistryService.ts` — added `createAgent`, `updateAgent`, `createDepartment`, `updateDepartment` (plus `CreateAgentInput`/`UpdateAgentInput`/`CreateDepartmentInput`/`UpdateDepartmentInput` types); updated header comments to declare this service canonical.
- `lib/crew/agent-registry.ts` — added `mergeFromRegistry(records: AgentRecord[])`, which reuses the existing `mergeRegistryIntoAgents()` bridge to enrich already-registered runtime agents with hierarchy metadata from the unified registry. Does not fabricate new agents (the runtime `Agent` type carries UI fields — personality, voice, workflow — that `AgentRecord` doesn't have).
- `app/api/agents/departments/route.ts`, `app/api/agents/managers/route.ts`, `app/api/agents/registry/route.ts` — switched from `lib/dashboard/dashboardService.ts` (static `AGENT_DEFINITIONS`) to `lib/agents/agentRegistryService.ts` (DB-backed with fallback).

**Database changes:** none required. Existing `agent_registry`/`agent_departments` schema (including `parent_id`, `children_ids`, `priority`, `tools` from earlier migrations) already had every column needed, and RLS already granted full CRUD to `anon, authenticated`.

**Verification performed:**
- Confirmed via repo-wide search that none of the three registry API routes were called by any frontend code, and that the `dashboardService` functions they used to call (`getDepartments`, `getManagersList`, `getAgentRegistry`, `getChiefAgent`) had no other callers — so the swap carries no known regression risk.
- `npx tsc --noEmit` — passes with zero errors across the whole project.
- `next lint` — zero new warnings/errors in any changed file (pre-existing warnings remain in unrelated files: `app/chat/page.tsx`, `components/layout/command-palette.tsx`, `components/temo/chat-dock.tsx`, `components/temo/command-deck.tsx`).
- No test runner exists in this project (`package.json` has no `test` script, no test files found), so no automated tests were run.

**Remaining limitation from this sprint:** `lib/crew/crew-coordinator.ts` and `lib/crew/crew-manager.ts` still populate `lib/crew/agent-registry.ts` from whatever `Agent[]` the UI/dashboard store passes to `init()`/`registerAll()` — they did not yet call the new `mergeFromRegistry()` method. This gap was closed in Sprint 1.5 (see below). Also unchanged: `lib/dashboard/dashboardService.ts`'s `getDepartments`/`getManagersList`/`getAgentRegistry`/`getChiefAgent` are now dead code (no callers remain) and are a cleanup candidate for a later sprint.

### Sprint 1.5 — Unified Registry Runtime Wiring (Completed)

**Objective:** close the remaining Sprint 1 gap by making the live crew routing runtime actually consume the unified registry, not just make it *possible* to.

**Current runtime initialization path (before this sprint):** `app/chat/page.tsx` holds an `agents` array (from the dashboard store's static seed data) and calls `crewCoordinator.init(agents)` in a `useEffect`. `CrewCoordinator.init()` (`lib/crew/crew-coordinator.ts`) synchronously called `this.registry.registerAll(agents)`, populating `lib/crew/agent-registry.ts`'s in-memory `Map` entirely from that static array — the unified registry was never consulted at runtime.

**Wiring change:** `CrewCoordinator.init()` now performs its existing synchronous registration (unchanged, so init remains non-blocking and backward compatible with its fire-and-forget caller in `app/chat/page.tsx`), then asynchronously calls `loadAgents()` from `lib/agents/agentRegistryService.ts` and feeds the result into `this.registry.mergeFromRegistry(records)`. This enriches the already-registered runtime agents with canonical hierarchy metadata (`level`, `parentId`, `childrenIds`, `departmentId`, `priority`, `tools`, `isActive`) from the unified registry, without replacing or blocking the existing initialization flow.

**Files modified:**
- `lib/crew/crew-coordinator.ts` — added the `loadAgents()` import and the post-init async merge call in `init()`.

No changes were made to `lib/crew/crew-manager.ts`: it was inspected per scope, but its `init()` method is not called anywhere in the codebase (confirmed by repo-wide search — `crewManager` is only referenced for `toggleFavorite()` in `app/agents/page.tsx`, which operates on a registry that is never populated). It is dead/legacy orchestration, not part of the live runtime path, so wiring it would have no runtime effect and was left untouched per "keep the implementation minimal."

**Fallback behavior:** `loadAgents()` already has its own internal try/catch that falls back to the static `AGENT_DEFINITIONS` on any DB error or empty result, so it effectively never rejects. `CrewCoordinator.init()` additionally wraps the merge call in a `.catch()` that logs via the existing `logger.routing()` call and leaves the already-registered (static-seeded) agents untouched — so a database outage degrades silently to the pre-Sprint-1.5 behavior rather than breaking chat/voice routing.

**Current registry architecture (as of Sprint 1.5):** `lib/agents/agentRegistryService.ts` remains the single canonical registry (read + write). `lib/crew/agent-registry.ts` is now actually kept in sync with it at runtime via `CrewCoordinator.init()` → `mergeFromRegistry()`, closing the gap identified in Sprint 1. `lib/crew/crew-manager.ts`'s copy of the same `AgentRegistry` class remains unsynced, but is inert (never initialized).

**Remaining registry-related limitations (as of Sprint 1.5):**
- The merge happens once, at first `init()` call (guarded by the existing `initialized` flag) — if agents/departments change in the database afterward, a running session will not pick up the change until next reload. No periodic re-sync exists (out of scope — would overlap with future queue/event-driven sprints).
- `lib/crew/crew-manager.ts` still holds a structurally duplicate `AgentRegistry` instance that is never populated or synced; it is dead code, not a live duplicate source of truth, but is a cleanup candidate.
- `lib/dashboard/dashboardService.ts`'s orphaned registry functions (noted in Sprint 1) remain unremoved.
- No UI exists yet to create/edit agents or departments through the Sprint 1 write functions.

### Sprint 2 — Generalized Manager → Worker Delegation (Completed)

**Objective:** generalize manager→worker delegation, which previously worked for Nova only, so any manager with registered active workers can delegate through the same mechanism — without adding a new orchestration layer or a new CEO layer.

**Key finding before implementing:** the **mission pipeline was already fully generic.** `lib/swarm/workerRouter.ts`'s `findWorkerForTask(managerId, capability)` — used by `lib/swarm/executionLayer.ts` — was already registry-driven for any manager (`parentId`/`level`/`isActive`/capability match), with correct null-fallback to direct manager execution when no worker exists. It required no changes. The only hardcoded-to-Nova path was the **simple-chat pipeline**: `lib/crew/crew-coordinator.ts` checked `selectedAgent?.id === 'nova'` and called `lib/crew/nova-delegation.ts`'s `delegateToWorker()`, which matched worker selection against a hardcoded per-worker keyword table for exactly `nova-frontend`/`nova-backend`/`nova-qa`.

**New generic delegation architecture:**
- **`lib/crew/manager-delegation.ts`** (new) — exports `delegateManagerTask(managerId, input, context, taskId, callbacks)`. Generalizes the Nova pilot's four-step pattern (select worker → execute worker → manager reviews → return) to work for any manager:
  1. **Identify the manager** via `agentRegistryService.getAgentById(managerId)`.
  2. **Find worker children** via `agentRegistryService.loadAgents()`, filtered to `level === 'worker' && isActive && parentId === managerId` — the same hierarchy rule `workerRouter.ts` uses for the mission pipeline.
  3. **Select by capability**: each candidate worker is scored by how many of its own registry `capabilities` (e.g. `react`, `testing`, `api_design`) appear as keywords in the request text. This generalizes Nova's old hardcoded `WORKER_KEYWORDS` table into registry data — no worker or manager name is hardcoded anywhere in this module.
  4. **Execute and review**: if a worker matches, it executes via `chatWithFallback` with a system prompt built from its registry `role`/`capabilities`; the manager then reviews the worker's output via a second LLM call and returns the polished response. Every step emits the same runtime events, timeline entries, and activity-feed items the Nova pilot did (`emitRuntimeEvent`, `onTimeline`, `onActivity`, `onAgentStatus`, `onWorkerActive`), so dashboard/mission observability is unchanged in shape.
  5. **Graceful no-worker path**: if the manager has no active workers, or no worker's capabilities match, `selectWorkerForManager` returns `null` and `delegateManagerTask` returns `{ delegated: false }` immediately — no worker is fabricated. The caller (crew-coordinator) falls through to normal direct-manager LLM execution, exactly as before.
- **`lib/crew/nova-delegation.ts`** — reduced to a thin, name-stable compatibility wrapper. `delegateToWorker(input, context, taskId, callbacks)` now calls `delegateManagerTask('nova', input, context, taskId, callbacks)`. `NOVA_WORKER_IDS`/`NovaWorkerId` are preserved for any external reference. This file is no longer called by `crew-coordinator.ts` (which now calls the generic function directly) but is kept so nothing importing it breaks.
- **`lib/crew/crew-coordinator.ts`** — the delegation trigger changed from `selectedAgent?.id === 'nova'` to `selectedAgent?.level === 'manager'` (a registry-derived field, present synchronously in the seed `Agent[]` and refreshed by the Sprint 1.5 `mergeFromRegistry` sync — confirmed no startup timing gap), and the call site now invokes `delegateManagerTask(selectedAgent.id, ...)` instead of the Nova-specific `delegateToWorker`. Timeline/activity text was generalized from hardcoded "Nova" strings to `selectedAgent.name`.

**How Nova is preserved:** Nova's behavior is unchanged in practice — `crew-coordinator.ts` still resolves to `delegateManagerTask('nova', ...)` when Nova is selected, worker selection still considers only `nova-frontend`/`nova-backend`/`nova-qa` (the only active workers registered under `parentId: 'nova'`), and the execute→review flow is identical. The only behavioral difference: worker selection now scores against each worker's registry `capabilities` array directly (e.g. `react`, `frontend`, `testing`) rather than the old hand-curated `WORKER_KEYWORDS` synonym lists (e.g. `usestate`, `stack trace`, `design system`) — a close but not byte-identical approximation, since the registry capability strings are a subset of the old keyword lists' breadth.

**How other managers are supported:** Flow, Atlas, Luna, Echo (and Orion, inactive) now go through the identical `delegateManagerTask(managerId, ...)` path when selected — the mechanism is manager-agnostic. Today they have **zero registered workers** in `agent_registry` (unchanged — Sprint 2 explicitly does not create workers for testing), so `selectWorkerForManager` returns `null` for all of them and they continue to execute directly via the existing LLM path, identical to their pre-Sprint-2 behavior. The mechanism will activate automatically the moment worker rows with matching `parent_id` are added to the registry — no code change will be required.

**Behavior when no worker exists:** `delegateManagerTask` returns `{ response: '', delegated: false }` without emitting any worker-specific runtime events (only the "Delegation skipped" timeline entry from the caller). `crew-coordinator.ts` falls through to its normal direct-manager LLM path, unchanged from pre-Sprint-2 behavior for every manager without workers.

**Files modified:**
- `lib/crew/manager-delegation.ts` (new) — generic delegation mechanism.
- `lib/crew/nova-delegation.ts` (rewritten) — thin compatibility wrapper over the generic mechanism.
- `lib/crew/crew-coordinator.ts` — trigger condition and call site generalized.

**Database changes:** None. Reuses the existing `agent_registry` columns (`parent_id`, `level`, `is_active`, `capabilities`) already populated by Sprint 1/1.5 migrations.

**Verification performed:**
- `npx tsc --noEmit` — passes with zero errors, project-wide.
- `next lint` — zero new issues in any changed file (same pre-existing unrelated warnings as prior sprints).
- Confirmed via repo-wide search that `delegateToWorker`/`nova-delegation` had exactly one external caller (`crew-coordinator.ts`), now updated; no other file referenced the removed internal Nova-specific helpers (`selectWorker`, `WORKER_DEFS`, `WORKER_KEYWORDS`), so nothing else could break.
- Confirmed the mission pipeline (`executionLayer.ts` → `workerRouter.ts`) required zero changes, since it was already generic — this sprint only touched the simple-chat pipeline.

**Limitations:**
- Worker selection in the chat path is still simple keyword-in-text scoring against registry capability strings — the same class of heuristic as before, not an LLM-based capability match. Good enough for V1, per the sprint's explicit scope.
- No workers exist yet for Flow/Atlas/Luna/Echo, so generalized delegation is currently unobservable beyond Nova in practice — the mechanism is ready but inert until worker rows are added (a future sprint's decision, not this one's).
- The mission-pipeline's `workerRouter.ts` `CAPABILITY_BRIDGE` (manager-level capability → worker skill) still only covers dev/technical capabilities — unchanged, out of this sprint's scope; would need extension before non-engineering managers could delegate through the *mission* path too.
- `lib/crew/nova-delegation.ts`'s `delegateToWorker` wrapper is now unused dead code from `crew-coordinator.ts`'s perspective (kept only for external backward compatibility) — a cleanup candidate once confirmed no other consumer needs it.

### Sprint 3 — Usage & Cost Governance Foundation (Completed)

**Objective:** create an append-only Usage Ledger recording AI token consumption at the execution level — the accounting foundation for future cost monitoring, mission/agent cost attribution, and (later) client billing/quotas. Explicitly not a billing system: no Stripe, no subscriptions, no multi-tenancy, no quotas.

**Where usage originates:** every AI completion in this app already flows through one function — `chatWithFallback()` in `lib/ai/ai-provider.ts` — which proxies to the `ai-chat` Supabase Edge Function and returns a `ChatResult` containing `usage: { inputTokens, outputTokens }` and `provider`. This was confirmed to be the single real choke point: 9 call sites across `lib/crew/crew-coordinator.ts`, `lib/crew/manager-delegation.ts`, `lib/swarm/executionLayer.ts`, `lib/memory/summarizer.ts`, `lib/crew/ai-intent-analyzer.ts`, and `lib/tools/planner.ts` all call it, and none call a provider directly.

**How usage is recorded:** `chatWithFallback()` itself now calls `recordUsage()` (new — `lib/ai/usageLedger.ts`) immediately after a successful provider response, before returning to the caller. This means usage recording required **zero changes** to any of the 9 call sites to start working — instrumenting the one choke point covers all of them automatically. `recordUsage()` inserts one row into the new `usage_ledger` table and **never throws**: any Supabase error is caught, logged via the existing `logger.providerWarn`, and swallowed, so a ledger failure can never fail an otherwise-successful AI call (verified: `chatWithFallback`'s existing retry/fallback/timeout logic is untouched — the recording call sits after a provider has already succeeded, outside any retry loop).

`ChatResult` gained a `model: string` field (the resolved model actually used) so the ledger can do model-level accounting even when a caller didn't request a specific model. The `ai-chat` edge function's `handleChat` now echoes back `ctx.model` (the server-resolved effective model) alongside the existing `content`/`usage`, so model attribution is accurate even when the client left `model` unset and a provider default was applied server-side — a small, additive change to the edge function response, not a new abstraction.

**Cost calculation:** `lib/ai/pricing.ts` — a static, manually maintained table of `{ inputPerMillion, outputPerMillion }` USD pricing per provider/model pair, covering every model currently selectable in `lib/settings/settings-service.ts`'s `PROVIDER_MODELS`. No network calls are made to fetch live pricing (as required). `estimateCost(provider, model, inputTokens, outputTokens)` returns `{ cost, isEstimated }`: known pricing → a computed cost, `isEstimated: true` (the table is static, so every cost is inherently an estimate, not a bill reconciliation); Ollama → `cost: 0, isEstimated: false` (self-hosted, zero marginal API cost is a known fact); unknown provider/model pair (e.g. an arbitrary OpenRouter-routed model, NVIDIA NIM, or a future provider) → `cost: null, isEstimated: true` — the row is still recorded with full token data, just without a dollar figure, per the sprint's explicit "nullable when unknown" requirement.

**Retry/attempt accounting:** decided **one ledger row per successful logical operation**, not one row per provider attempt. Reasoning: `AIProviderImpl.chat()`'s internal retry loop (up to 3 attempts) and `chatWithFallback`'s provider-fallback loop both only return a `ChatResult` on success — a failed attempt (429/500/network error) never produces token usage to log, since the provider never returned a billable completion. `chatWithFallback` returns immediately on the first success, so there is structurally exactly one successful attempt per call. This means "one row per attempt" and "one row per logical operation" coincide in this codebase today, and retries never produce duplicate rows. A `correlation_id` column (UUID, defaults to a fresh value per row) is reserved on the table for future work that might want to log failed attempts too and tie them to their eventual successful row — not used for that purpose yet, since there's no usage data to attach to a failed attempt today.

**Attribution model:** `ChatOptions` gained an optional `usageContext` field (`operation`, `missionId`, `taskId`, `agentId`, `managerId`, `metadata`) — purely additive, no function signatures were redesigned. Wired at the 4 call sites where attribution context was already in scope, with the operation type distinguishing them:
- `lib/swarm/executionLayer.ts` (mission pipeline) → `operation: 'mission_task'`, full `missionId`/`taskId`/`agentId` (worker if delegated, else manager)/`managerId`.
- `lib/crew/crew-coordinator.ts` `generateResponse` → `operation: 'chat'`, `agentId`.
- `lib/crew/crew-coordinator.ts` `generateToolResponse` → `operation: 'tool_response'`, `agentId`.
- `lib/crew/manager-delegation.ts` `executeWorker` → `operation: 'worker_execution'`, `agentId` (worker), `managerId`.
- `lib/crew/manager-delegation.ts` `managerReview` → `operation: 'manager_review'`, `agentId` (manager).

The other 5 call sites (`summarizer.ts` ×3, `ai-intent-analyzer.ts`, `tools/planner.ts`) were left unmodified — they still get a ledger row (recording happens regardless, at the choke point), just with `operation: 'chat'` (the default) and null mission/task/agent attribution, which is correct: they are system-level operations with no natural mission/agent owner.

**Failure behavior:** ledger recording is fully non-blocking with respect to correctness — `recordUsage()` catches and logs every error internally and always resolves. The AI call's success/failure is determined entirely before `recordUsage()` is invoked, so a database outage degrades to "usage silently not recorded, chat/mission still works," never the reverse. **Streaming responses are not currently recorded** (see limitations below) — `streamWithFallback()`/`chatStream()` return only accumulated text, no usage data, since the edge function's SSE protocol never emits a final usage frame; recording there would require a cross-cutting protocol change and was out of this sprint's minimal-change scope.

**Reporting (read-only, no UI):** `lib/ai/usageLedger.ts` exports `getTotalUsage()`, `getUsageByProvider(provider)`, `getUsageByModel(model)`, `getUsageByMission(missionId)`, `getUsageByAgent(agentId)`, `getUsageByManager(managerId)`, each returning a `UsageTotals` (`totalCalls`, `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `totalEstimatedCost`, `unpricedCalls`). No dashboard page or UI was built, per scope.

**Database changes:** one additive migration, `supabase/migrations/20260819120000_create_usage_ledger.sql` — creates `usage_ledger` only; no existing table/column is modified. RLS is enabled with **only SELECT and INSERT policies** (no UPDATE/DELETE policies at all), which makes Postgres RLS deny modification/deletion by default — enforcing the "append-only, never modify or delete historical records" requirement at the database layer, not just by application convention. `mission_id`/`task_id` are nullable UUID FKs to `missions`/`mission_tasks`; `agent_id`/`manager_id` are nullable text FKs to `agent_registry.id`; `provider`/`operation` are plain `text` (not enums) so new providers/operation types never require a schema migration to be logged — a deliberate, documented departure from this project's usual enum convention for closed sets, justified by Sprint 3's explicit "must support future providers" principle. A `tenant_id`/`client_id`/`company_id` column was intentionally **not** added — multi-tenancy is out of scope — but the nullable, text/uuid-heavy design leaves room for one later without breaking existing rows.

**Files modified:**
- `supabase/migrations/20260819120000_create_usage_ledger.sql` (new)
- `lib/ai/pricing.ts` (new)
- `lib/ai/usageLedger.ts` (new)
- `lib/ai/ai-provider.ts` — `ChatResult.model`, `ChatOptions.usageContext`, `recordUsage()` call in `chatWithFallback`
- `supabase/functions/ai-chat/index.ts` — `handleChat` now echoes `model`
- `lib/swarm/executionLayer.ts` — `usageContext` on its `chatWithFallback` call
- `lib/crew/crew-coordinator.ts` — `usageContext` on its two `chatWithFallback` calls
- `lib/crew/manager-delegation.ts` — `usageContext` on its two `chatWithFallback` calls

**Verification performed:**
- `npx tsc --noEmit` — passes, zero errors, project-wide.
- `next lint` — zero new issues; same pre-existing unrelated warnings as prior sprints.
- Confirmed all 9 `chatWithFallback`/`streamWithFallback` call sites still compile unchanged in signature (usageContext is optional).
- Confirmed no second AI-provider abstraction was introduced — `pricing.ts`/`usageLedger.ts` only consume the existing `ChatResult`/`ProviderId` types.
- Confirmed the migration contains no `ALTER`/`DROP` against any existing table — additive only.
- Confirmed (by reading `AIProviderImpl.chat()` and `chatWithFallback`) that retry/fallback/timeout logic is structurally unchanged; `recordUsage()` is only ever called after a successful result, outside any retry loop.

**Remaining limitations:**
- Streaming chat responses (`streamWithFallback`) are not recorded — no usage data is available from the streaming protocol today. Fixing this would require the edge function's SSE stream to emit a final usage frame and each provider adapter's stream parser to capture it — a larger, cross-cutting change deferred to a future sprint.
- Pricing data is static and manually maintained; it will drift from live provider pricing over time and must be updated by hand in `lib/ai/pricing.ts`.
- NVIDIA NIM and non-preset OpenRouter models have no pricing entries — their usage is recorded with `estimated_cost: null`.
- No quotas, budgets, spend caps, or alerts exist yet — this sprint only records usage; enforcement is future work.
- No UI/dashboard surfaces this data yet — only the service-layer reporting functions exist.
- The 5 non-attributed call sites (summarizer, intent analyzer, tool planner) record usage but with null mission/agent attribution — acceptable per scope, but means total-cost-by-agent queries will undercount system-level LLM usage.

---

## 4. CURRENT MISSION LIFECYCLE

```
User (chat or voice)
  │
  ▼
unifiedOrchestrator.orchestrate()          [lib/swarm/unifiedOrchestrator.ts]  — the single real entry point
  │
  ▼
decisionEngine.makeDecision()              [keyword/heuristic scoring — deterministic, not ML]
  │
  ├── SIMPLE ─────────────────────────────────────────────────┐
  │                                                            ▼
  │                                            crewCoordinator.routeAndRespond()  [lib/crew/crew-coordinator.ts]
  │                                              → aiIntentAnalyzer (real LLM call)
  │                                              → routingEngine → taskClassifier/taskRouter
  │                                              → optional novaDelegation or n8nActionHandler
  │                                              → chatWithFallback() → ai-chat edge function → provider API
  │                                              → response persisted, memory.remember() called
  │
  └── MISSION ────────────────────────────────────────────────┐
                                                                ▼
                                          missionEngine.launchMission()
                                            → missionPlanner.planMission()      [regex/keyword capability extraction — no LLM]
                                            → missionService.createMission/Objectives/Tasks   [Supabase, real CRUD]
                                            → swarmManager.dispatchTasks()      [sequential for-loop]
                                                → capabilityMatcher.matchCapability()   [assigns one manager per task]
                                          executionLayer.executeMissionTasks() [sequential for-loop — comment: "parallel execution is Phase 4"]
                                            → workerRouter.findWorkerForTask() [hardcoded capability bridge; ~10 dev-centric capabilities covered, others fall back to the manager itself]
                                            → managerContext.buildManagerContext()  [pulls memory, knowledge, tools, prior task outputs]
                                            → chatWithFallback() → ai-chat edge function → provider API [with retry/backoff + 30s timeout]
                                            → result + timeline entry + runtime_activity event written to Supabase
                                          unifiedOrchestrator.buildMissionResponse()  [synthesizes final chat reply from last completed task]
```

**Implemented vs. planned:**
- Implemented: decision routing, mission planning (keyword-based), full DB persistence of missions/objectives/tasks, manager assignment, per-task LLM execution with retries/timeouts, timeline + runtime event logging, SSE polling for UI updates.
- Planned but not implemented (per in-code comments): parallel task execution ("Phase 4"), LLM-based mission planning (planner currently pure keyword matching), worker assignment across non-technical capabilities, a background queue/scheduler independent of the live request.
- **Not implemented at all:** review/approval gates before task execution, cost/budget checks, multi-tenant scoping of missions.

---

## 5. CURRENT MEMORY / KNOWLEDGE ARCHITECTURE

- **Short/episodic/long-term memory** (`lib/memory/shortTermMemory.ts`, `episodicMemory.ts`, `longTermMemory.ts`) — all three write to the **same** `memories` table, differentiated by a `type` column and `importance`/`expires_at` fields, rather than being architecturally distinct stores. Short-term has real TTL/trim logic (capped at 20 items by default). Episodic additionally writes to a separate `memory_events` table for a timeline, duplicating content across two tables. Long-term is functionally a default `store()` call plus optional LLM-generated importance/summary.
- **pgvector** — `memory_embeddings` table, `vector(3072)`, HNSW index. Real, populated via the `embeddings` Supabase Edge Function which calls real embedding APIs (Gemini/OpenRouter/NVIDIA/Ollama/OpenAI) using keys stored in `app_settings`.
- **Semantic search** — `lib/memory/semanticSearch.ts` queries the `match_memories` Postgres RPC. Real, but failures in the hybrid path are silently swallowed (`.catch(() => [])`), degrading to keyword-only search with no user-visible signal.
- **Knowledge extraction** — `lib/knowledge/factExtractor.ts` is purely regex-based, matching ~15 hardcoded sentence patterns (e.g. "my favorite IDE is X", "I work at X"). It never calls an LLM. Anything not matching an exact pattern produces no structured facts.
- **Knowledge graph** — `lib/memory/knowledgeGraph.ts` stores generic `memory_links` edges (source/target/type/weight) with a BFS neighbor walker. Nothing in the fact-extraction pipeline automatically populates this graph — it is only populated if some other caller manually links records. The "gbrain" visualization (`lib/gbrain/graph-builder.ts`) is cosmetic UI built from live agent/mission/provider state plus hardcoded placeholder labels ("Facts"/"Entities"/"Relations") that are not bound to real graph data.
- **Context builder** — `lib/context/context-manager.ts` / `context-builder.ts` implement a real, complete pipeline: Intent detection (regex-based, `intent-detector.ts`) → Memory retrieval → Tool selection → RAG injection (capped at top 5 results, 200 chars each) → LLM call assembly. This is one of the most complete subsystems in the codebase.
- **Known scaling risks:** `memory.summarizeAll()` loads up to 200 records and LLM-summarizes any missing summary sequentially, with no batching; `memory.stats()` fetches up to 10,000 full rows just to produce a count; a `clean_expired_memories()` SQL function exists but nothing ever calls it, so soft-deleted/superseded rows accumulate indefinitely.

---

## 6. CURRENT TOOL / AUTOMATION ARCHITECTURE

- **Tool registry** (`lib/tools/registry.ts`) — dynamic Map-based registration of tool definitions. Real.
- **Tool executor** (`lib/tools/executor.ts`) — parameter validation, permission check, `AbortController`-based timeout, exponential-backoff retry, event emission. Real and functioning.
- **Permissions** (`lib/tools/permissions.ts`) — a flat, hardcoded map of agent → allowed permission categories (`AGENT_PERMISSIONS` in `types.ts`). No per-tenant/per-user scoping, no DB-backed ACL. Enforcement is coarse: a mismatch is only logged as a warning, not blocked.
- **Chaining** (`lib/tools/chain.ts`) — sequential multi-step tool execution with shared context. Real.
- **Planner** (`lib/tools/planner.ts`) — LLM selects tool(s) from the permission-filtered catalog via `chatWithFallback`, parses JSON response. Real.
- **n8n integration** — frontend (`services/n8n/n8nClient.ts`) posts to the `n8n-proxy` edge function, which holds credentials server-side (from `app_settings`) and makes real REST calls to an n8n instance. Execution is webhook-based only (the n8n REST API doesn't support direct `/executions` POST); `triggerDetector.ts` classifies trigger type and `convertToWebhook` synthesizes a webhook trigger where needed. Registry sync persists trigger metadata to `workflow_registry`. This integration is fully real, not a stub.
- **Implemented vs. placeholder tools:**
  - Implemented: 11 n8n tools, 8 memory tools — all wired to working backends.
  - Placeholder: Gmail, Google Drive, Calendar, GitHub PR/commit, file read/write, web search — all resolve to a `placeholderHandler` that logs a warning and returns `"{service} adapter not yet configured"`.
  - `voice.speak`/`voice.listen` are listed as `status: 'active'` tools but also route through the placeholder handler as *tools* (the underlying voice subsystem works, but not as an invokable tool).
  - The Tools UI page (`app/tools/page.tsx`) renders a fully static, hardcoded array disconnected from the real tool registry — it does not reflect actual tool status.
- **Approval gates for tool actions:** none found. Destructive actions (delete n8n workflow, permanent memory delete) execute immediately with no confirmation step.

---

## 7. AI PROVIDER ARCHITECTURE

**Supported providers:** Gemini, Groq, NVIDIA NIM, OpenRouter, Ollama (`lib/settings/settings-service.ts`). OpenAI/Anthropic have legacy DB columns but are explicitly unused.

**Flow:** `lib/ai/ai-provider.ts` does not call provider SDKs directly from the client app — it POSTs to the Supabase Edge Function `ai-chat`, which loads provider keys from `app_settings` and dispatches to real per-provider HTTP adapters (confirmed in `supabase/functions/ai-chat/index.ts`), supporting both streaming and non-streaming responses. The `embeddings` edge function mirrors this pattern for embedding calls.

**Fallback/retry architecture:** `chatWithFallback()` / `streamWithFallback()` try the active provider first, then walk a defined `FALLBACK_ORDER`, retrying transient errors (HTTP 429/500–504) with exponential backoff, and skipping immediately to the next provider on 401 (auth failure). This client-side logic is real and functioning, not a stub.

**Cost tracking:** as of Sprint 3, `ChatResult.usage` (`inputTokens`/`outputTokens`) is persisted to the append-only `usage_ledger` table on every successful call via `lib/ai/usageLedger.ts`, with cost estimated from the static pricing table in `lib/ai/pricing.ts` and attributed to mission/task/agent/manager where that context is available. There is still no budget cap or spend enforcement — only recording (see Sprint 3 section below).

---

## 8. CURRENT RUNTIME LIMITATIONS

- **Static agent registry (partially resolved in Sprint 1).** The org chart is still the same compiled-in set of 9 agents / 6 departments — Sprint 1 did not add new agents/departments (out of scope). What changed: the DB schema now has a real write path (`createAgent`/`updateAgent`/`createDepartment`/`updateDepartment`) and the live API routes read from the DB-backed registry instead of the static one. No UI yet exists to actually create/edit agents or departments through these new functions.
- **Duplicate registries/orchestration paths (resolved for the live path in Sprint 1.5).** `lib/agents/agentRegistryService.ts` is the canonical registry. `lib/crew/agent-registry.ts` is now synced from it at runtime — `CrewCoordinator.init()` calls `mergeFromRegistry()` after registering the initial `Agent[]`, so live chat/voice routing reflects the unified registry's hierarchy metadata. `lib/crew/crew-manager.ts` still holds its own unsynced `AgentRegistry` instance, but it is dead code (never initialized in the current app). Routing/scoring logic is still separately duplicated between `lib/crew/task-router.ts` and `lib/swarm/capabilityMatcher.ts`/`workerRouter.ts` — unchanged, out of scope for this sprint.
- **Nova-only delegation (mechanism generalized in Sprint 2; still Nova-only in practice).** The delegation *mechanism* (`lib/crew/manager-delegation.ts`, plus the pre-existing `lib/swarm/workerRouter.ts` on the mission path) is now registry-driven and works for any manager. But only Nova has active worker rows registered in `agent_registry` (`nova-frontend/backend/qa`); Flow/Atlas/Luna/Echo have zero registered workers, so they still execute tasks directly — not because of hardcoded logic, but because no worker data exists for them yet. Adding worker rows for other departments (a future decision) would activate delegation for them with no further code change.
- **Synchronous task execution (V1: background queue foundation added, not yet scheduled).** The primary path is still one mission executed synchronously within its triggering HTTP/chat request. A real atomic-claim queue (`claim_ready_tasks()` + `/api/tasks/process`) now exists and reuses `executeTask()` directly, but no `pg_cron` schedule was created (needs a deployed URL) — see the V1 section above for exact activation steps.
- **No multi-tenancy → RESOLVED (V1).** `tenants`/`tenant_members` + `tenant_id` on every core data table, `is_tenant_member()`-scoped RLS, auto-provisioning on signup. See the V1 section above for the full model.
- **No authentication/security → RESOLVED (V1).** Real Supabase Auth is now required (`AuthGate`, `/login`); `lib/api/security.ts`'s no-op stubs are superseded by `lib/auth/apiAuth.ts`'s `requireUser()` for API routes. RLS is authenticated-only project-wide.
- **No cost/budget governance (accounting foundation added in Sprint 3; V1 adds tenant attribution + a budgets table; hard enforcement still missing).** `usage_ledger.tenant_id` and `checkBudget()` exist and are queryable; nothing yet blocks a spend before it happens — see the V1 section's "Known limitations."
- **No approval gates → RESOLVED (V1) for tool-executor-routed actions.** `requiresApproval` + `lib/governance/approvals.ts`, wired into `lib/tools/executor.ts`. Actions outside the tool executor (none currently exist) aren't covered — mechanism is ready for them.
- **No client billing/freemium → Foundation added (V1).** `packages`/`tenant_entitlements` + `checkEntitlement()`, wired into mission creation. Billing integration itself (Stripe or similar) is explicitly deferred, by design (Section 14 of the V1 mission).
- **Other significant limitations:**
  - Regex-only knowledge extraction — will not scale to arbitrary organizational knowledge capture.
  - Runtime events are polling-based (1.5–2s interval), not push/pubsub — will not scale with many concurrent missions.
  - Broken stat reporting: `dashboardService.getKnowledgeStats()` queries a nonexistent column, so knowledge stats silently return zero.
  - No decision/audit log distinct from operational mission timeline — no structured capture of "why" a decision was made.
  - Worker "lifecycle" is a DB row + prompt, not an isolated execution context — acceptable for a single-tenant system but insufficient for tenant-isolated multi-tenant work later.

---

## 9. CORPORATE AI OS TARGET ARCHITECTURE (High Level — Not Implemented)

```
Human Owner
    │
    ▼
Temo — Corporate CEO / Orchestrator
    │
    ▼
Corporate Office
    ├── Strategy
    ├── R&D / Innovation
    ├── Quality / Audit
    ├── Finance / Governance
    └── Workforce / Resource Management
    │
    ▼
Companies  (multiple, independently dynamically created)
    │
    ▼
Departments
    │
    ▼
Managers
    │
    ▼
Shared AI Workforce (Workers — reusable specialists, not one-per-customer)
    │
    ▼
Missions → Tasks → Queue/Execution → Review
    │
    ▼
Memory / Knowledge  (feeds and is fed by Missions)
    │
    ▼
R&D / Organizational Learning  (sandbox, lessons learned, self-improving SOPs)
    │
    ▼
Client Organizations  (isolated tenants, each with a dedicated AI Account Manager identity, isolated dashboard, billing/credits)
```

This is a target description only. No multi-company, multi-tenant, queue-based, or client-facing components exist in the current codebase (see Section 8). Implementation is intentionally deferred to the phased roadmap below.

---

## 10. IMPLEMENTATION ROADMAP

**Phase 1 — Core Corporate OS**
- Unified Agent Registry (single writable source of truth, retiring the duplicate `lib/crew` registry)
- Generalized Manager → Worker delegation (extend `nova-delegation.ts`'s pattern to all managers, driven by DB hierarchy)
- Usage/Cost Ledger (persist the `ChatResult.usage` data already computed but currently discarded)
- Security/Auth foundation (replace no-op stubs in `lib/api/security.ts` with real Supabase Auth)
- Approval gates (a `requires_approval` flag + pending-approval state for destructive/costly actions)
- Audit/Decision logs (a dedicated table distinct from the operational mission timeline)

**Phase 2 — Real Business Operations**
- Task Queue (decouple mission execution from the triggering HTTP request)
- Background execution (a worker process/poller consuming the queue)
- Parallel execution (multiple tasks/missions concurrently, per existing "Phase 4" comments in the code)
- LLM knowledge extraction (replace the regex-based `factExtractor.ts`)
- Capacity/resource management (forecasting and growth gates, built on the usage ledger + mission history)
- R&D/Simulation sandbox (isolated flag on missions/agents for testing new models/tools/agents without affecting production workforce)

**Phase 3 — Client-Facing AI Agency**
- Multi-tenancy (`tenants`/`clients` table + tenant-scoped RLS across all data tables)
- Client dashboards (isolated route/auth scope, separate from the internal corporate UI)
- Client AI Account Manager (a registry entry pattern reusing the Phase 1 dynamic registry — not a new agent architecture)
- Freemium/credits
- Packages/billing
- Multilingual client-facing layer (i18n layered on the existing context builder)

---

## 11. ARCHITECTURAL PRINCIPLES

- Reuse existing working components; do not rebuild unnecessarily.
- One source of truth for agents/departments.
- Temo is the CEO/orchestrator, not a separate unnecessary CEO layer.
- Managers delegate to workers.
- Agents are logical identities/capabilities, not necessarily separate processes.
- Keep infrastructure scalable without premature complexity.
- Cost awareness must be built into the architecture.
- Human approval remains required for important financial/destructive decisions.
- Prefer modular evolution over rewriting the existing system.

---

## 12. CURRENT STATUS

| Component | Status | Notes | Priority |
|---|---|---|---|
| Agent/department static definitions | WORKING | Fixed 9 agents / 6 departments, compiled-in | — |
| Agent registry DB read layer | WORKING | Canonical as of Sprint 1; reads DB, falls back to static seed data | — |
| Agent registry DB write path | WORKING | Added in Sprint 1 — `createAgent`/`updateAgent`/`createDepartment`/`updateDepartment`; no UI yet calls them | Medium |
| Registry API routes (`/api/agents/*`) | WORKING | Migrated in Sprint 1 to read from the unified registry | — |
| Duplicate crew registry (`lib/crew/agent-registry.ts`) | WORKING | No longer authoritative; kept in sync with the unified registry at runtime via `CrewCoordinator.init()` → `mergeFromRegistry()` as of Sprint 1.5 | Low |
| Nova → worker delegation | WORKING | Preserved via `manager-delegation.ts` (Sprint 2), routed through the generic mechanism with `managerId: 'nova'` | — |
| Generalized manager → worker delegation mechanism | WORKING | `lib/crew/manager-delegation.ts` (chat path) + `lib/swarm/workerRouter.ts` (mission path, already generic pre-Sprint-2); registry-driven, no hardcoded manager/worker names | Low |
| Other 5 managers' delegation | MISSING (mechanism ready) | Mechanism works for any manager, but Flow/Atlas/Luna/Echo have zero registered workers in `agent_registry` — no worker data exists yet, not a code limitation | Medium |
| Decision engine (simple vs. mission) | WORKING | Deterministic keyword/heuristic scoring | Low |
| Mission planner | WORKING | Regex/keyword capability extraction, no LLM | Medium |
| Mission/task DB persistence | WORKING | Full Supabase CRUD | — |
| Capability matcher / worker router | PARTIAL | Real, but bridge covers ~10 dev-centric capabilities only | Medium |
| Task execution (retry/timeout) | WORKING | Real, but sequential/in-request | — |
| Unified orchestrator | WORKING | Confirmed single live entry point | — |
| Runtime event/state store | WORKING | Polling-based SSE, not pubsub | Medium |
| Short/episodic/long-term memory | PARTIAL | Mostly flags on one table, not architecturally distinct | Medium |
| Semantic search / pgvector | WORKING | Real embeddings + RPC-based retrieval | — |
| Knowledge extraction | PARTIAL | Regex-only, ~15 hardcoded patterns | Medium |
| Knowledge graph | PLACEHOLDER | Generic edges, not auto-populated; gbrain UI cosmetic | Low |
| Context builder | WORKING | Complete intent → memory → tools → RAG → LLM pipeline | — |
| Tool executor core | WORKING | Validation, permissions, retries, chaining all real | — |
| Tool execution inside missions | WORKING | M1-01 (2026-08-25) — `executionLayer.ts`'s `executeTask()` now calls the real tool executor via `decideTools()`, same as the chat path; a failed tool call fails the task (existing retry loop), success bypasses the LLM entirely | — |
| Tool permissions | PARTIAL | Flat hardcoded map, warn-only enforcement | Medium |
| Built-in tools (n8n, memory) | WORKING | Real backends | — |
| Built-in tools (Gmail/Drive/Calendar/GitHub/files/web search) | PLACEHOLDER | Explicitly unconfigured adapters | Medium |
| Tools UI page | PLACEHOLDER | Fully static, disconnected from real registry | Low |
| n8n integration | WORKING | Real webhook-based bridge; M1-04 (2026-08-26) — `handleRun()` now polls real execution history for a genuine terminal status instead of reporting the trigger's HTTP 200 as "Done" | — |
| Multi-provider AI chat | WORKING | 5 real providers, fallback/retry | — |
| Voice (browser STT/TTS) | WORKING | No cloud provider integrated | Low |
| Chat conversation persistence | WORKING | M1-05 (2026-08-26) — `app/chat/page.tsx` loads the tenant's most recent conversation on mount (localStorage first, DB fallback for a fresh browser/device) instead of always starting fresh; `ConversationService` was already writing every message for real, the gap was purely the client-side load/resume lifecycle | — |
| Authentication/security | WORKING (V1) | M1-06 (2026-08-26) — all 23 `app/api/**` routes audited: every one already calls `requireUser()` or an equivalent real mechanism (no unauthenticated routes found); 2 real IDOR gaps found and fixed (`stream/mission`, `tasks/queue` accepted an attacker-controlled `missionId` with no tenant check); 16 routes remain authenticated-but-not-tenant-scoped because they serve global/aggregate operational data, not per-record lookups — flagged as a genuine open product decision, not silently resolved | — |
| Rate limiting (API routes) | WORKING | M1-03 (2026-08-26) — token-bucket (`check_rate_limit()` Postgres function + `lib/api/rateLimit.ts`) on the 2 routes that can actually trigger an AI call or tool execution (`tasks/process`, `settings/validate-provider`); every other `app/api/**` route is read-only/CRUD with no AI/tool trigger, confirmed by grep, not assumed | — |
| Multi-tenancy | WORKING (V1) | `tenants`/`tenant_members`/RLS/auto-provisioning; shared workforce, isolated data | — |
| Usage ledger (token/cost accounting) | WORKING | Sprint 3 + V1 tenant attribution — `usage_ledger` table + `lib/ai/usageLedger.ts` | — |
| Cost/budget governance (enforcement) | WORKING | M1-02 (2026-08-26) — `checkBudget()` is now a real hard gate inside `chatWithFallback()`/`streamWithFallback()` themselves (`lib/ai/ai-provider.ts`), the single choke point every real AI call passes through regardless of caller; Ollama exempt; internal tenant seeded with a real (adjustable) ceiling | — |
| Approval gates | WORKING (V1) | `approval_requests` + `lib/governance/approvals.ts`, wired into the tool executor | — |
| Internal Operator Mode | WORKING (first capability) | M1-09 (2026-08-26) — `lib/governance/internalTenant.ts` + `lib/tools/operator-tools.ts`; first capability (`operator.n8n.createWorkflowFromDescription`) gated by `requiresApproval: true` and a tenant assertion inside the handler itself that runs regardless of approval status — proven structurally impossible for a client tenant even after a mistaken approval, not just policy | — |
| Audit/decision logs | MISSING | Only operational timeline exists, no rationale capture | Medium |
| Automated test coverage | WORKING (narrow) | M1-07 (2026-08-26) — Vitest, `npm test`; 3 real integration test files (tenant isolation, `requireUser()`/`isTenantMember()` auth gate, mission status/progress rollup) against the live Supabase project, deliberately narrow not broad | Medium |
| Task queue/background workers | PARTIAL (V1) | `claim_ready_tasks()` + `/api/tasks/process` exist and reuse `executeTask()`; no `pg_cron` schedule created yet (needs deployment) | Medium |
| Parallel task execution | MISSING | Explicitly flagged in code as future phase | Medium |
| Client billing/freemium | PARTIAL (V1) | `packages`/`tenant_entitlements`/`checkEntitlement()` wired into mission creation; no payment integration (by design) | Low |
| Client AI Account Manager | WORKING (V1) | `client_profiles` + prompt identity injection (Sections 15–16); config-based, not a new agent | — |
| Simulation / R&D mode | WORKING (V1) | `missions.is_simulation` gates tool executor side effects + entitlement consumption | — |
| Organizational learning (lessons learned) | PARTIAL (V1) | `lessons_learned` table + RLS exist; nothing writes to it yet | Medium |
| Multi-company support | WORKING (V1) | `tenants` table itself is the multi-company mechanism (any tenant can represent a company) | — |

---

## PGVECTOR INDEX DIMENSION FIX (Hotfix — Fresh Project Initialization)

Discovered while initializing a fresh Supabase project (`lqwgprudmhqsqjqoeqjt`) for the UI reconciliation mission: running the full migration set produced `ERROR: 54000: column cannot have more than 2000 dimensions for ivfflat index`.

**Root cause.** `memory_embeddings.embedding` is `vector(3072)` (set in `supabase/migrations/20260727112722_update_vector_dimension_3072.sql`, sized for Gemini's `gemini-embedding-001` default output). pgvector caps **both** `ivfflat` and `hnsw` index types at 2000 dimensions on the plain `vector` type — 3072 exceeds that for either method. The migration already wrapped the `CREATE INDEX ... USING hnsw` attempt in a `DO $$ BEGIN ... EXCEPTION WHEN others THEN RAISE NOTICE ... END $$;` block specifically anticipating this. That worked as designed: verified via direct REST probes against the live project that **every table from all 21 migrations exists**, and the `match_memories` RPC executes successfully against a live 3072-dimension query vector. The exception was caught and turned into a non-fatal `NOTICE` — the Supabase SQL Editor's UI surfaces that raised notice prominently enough to read as a failure, but no migration was actually aborted and the database initialized completely. (Confusingly, pgvector's error text says "ivfflat index" even when the failing statement creates an `hnsw` index — a known message quirk in the extension, not a sign the wrong index type was attempted.)

**Chosen solution.** Replaced the try/catch-and-notice approach with an explicit no-index decision, documented inline in the migration rather than discovered via a scary-looking runtime notice. Evaluated per the requested options:
- **(A) Reduce embedding dimensions/model** — rejected: would mean picking one fixed low-dimension model and abandoning the multi-provider embedding support already built into `embeddingService.ts`/the `embeddings` edge function (Gemini, OpenRouter, NVIDIA, Ollama, OpenAI — see compatibility note below).
- **(B) No ANN index — exact/sequential search** — **chosen**. `match_memories()`'s `ORDER BY e.embedding <=> query_embedding LIMIT match_count` works correctly and fast enough at this project's current single-tenant, early-stage data volume without any index. Critically, this is not a correctness compromise: ivfflat/hnsw are *approximate* nearest-neighbor methods; removing the index makes search **exact**, strictly more correct, with a speed tradeoff that doesn't matter yet.
- **(C) `halfvec` + hnsw** — pgvector's half-precision `halfvec` type supports HNSW indexing up to 4,000 dimensions, which would cover this column and enable real ANN search. Documented as the future upgrade path, **not implemented now**: it depends on a pgvector extension version (0.7.0+) not confirmed available on this project, and would require also updating `match_memories()` to cast both sides of the comparison to `halfvec` for the index to be used. Revisit once memory volume actually justifies an ANN index.
- **(D) Other** — none identified; pgvector has no third indexed-vector type today.

**Files changed:**
- `supabase/migrations/20260727112722_update_vector_dimension_3072.sql` — removed the `DO $$ ... CREATE INDEX ... hnsw ... EXCEPTION ...` block; replaced with a comment explaining why no index is created on this column and what would need to be true to revisit it (Option C above).
- `.claude/_apply_all_migrations.sql` (regenerated, gitignored scratch artifact) — combined migration file used to initialize the fresh project, updated to match.

**Was the database partially initialized?** No. Verified via read-only REST probes (`GET /rest/v1/<table>?limit=1`) against all 21 migrations' tables, from the first (`app_settings`) through the last (`usage_ledger`): all returned HTTP 200. The `match_memories` RPC was also called directly with a 3072-dimension test vector and returned successfully (empty result set, since no memories exist yet — not an error). The live project's schema is fully initialized and already matches what the fixed migration produces (no index either way) — **no manual re-run against this specific project is required**; the fix matters for future fresh installs so the confusing notice doesn't reappear.

**Embedding dimension consistency (compatibility considerations — found, not fixed, out of this hotfix's scope):** the `vector(3072)` column size only matches embedding models that output *exactly* 3072 dimensions — pgvector's `vector(n)` enforces an exact match, not a maximum. Cross-checking `embeddingService.ts`'s provider list against known model output sizes:

| Provider/model | Typical dimensions | Fits `vector(3072)`? |
|---|---|---|
| Gemini `gemini-embedding-001` (default) | 3072 | Yes |
| OpenAI `text-embedding-3-large` (incl. via OpenRouter) | 3072 | Yes |
| OpenAI `text-embedding-3-small` (incl. via OpenRouter) | 1536 | **No — insert would fail** |
| NVIDIA `nv-embed-v1` | 4096 | **No — insert would fail** |
| Ollama `nomic-embed-text` / `all-minilm` / `mxbai-embed-large` | 768 / 384 / 1024 | **No — insert would fail** |

Selecting any provider/model other than the 3072-dimension default in Memory settings would currently fail at `embeddingService.storeEmbedding()`'s insert with a dimension-mismatch error, not a graceful degradation. This is a pre-existing gap in the multi-provider embedding architecture, not something this hotfix introduced or was asked to fix — flagged here for a future sprint (likely: pin one canonical embedding model for V1 and hide the others from the provider list until per-model dimension columns or a padding/truncation scheme exists).

**Risk to existing Memory/RAG functionality:** none. No behavior changed for any embedding that was already working (3072-dim Gemini path) — `match_memories()`'s query/logic is untouched, only the (already-nonexistent, already-caught-as-a-notice) index attempt was removed.

## V1 — CORPORATE AI OS / AI AGENCY FOUNDATION

This is the Master V1 Build Mission's architecture. It builds directly on every prior sprint (registry, delegation, usage ledger, workspace tooling) — nothing described here replaces that work; it adds multi-tenancy, real authentication, approval gates, package entitlements, a simulation mode, and a background task queue on top of it.

### Runtime flow (updated)

```
User (signed in, browser session)
  → AuthGate (stores/authStore.ts) — redirects to /login if no session
  → orchestrate(userRequest, { tenantId, isSimulation? })   [tenantId now REQUIRED]
      → decisionEngine → simple (CrewCoordinator) or mission (missionEngine) branch, unchanged
      → missionEngine.launchMission() now:
          1. checkEntitlement(tenantId)  — Section 14, blocks if package/credit limit reached
          2. creates the mission with tenant_id + is_simulation
          3. consumeProjectSlot(tenantId) on success
      → executionLayer.executeTask() — unchanged, now also tags usage_ledger rows with tenant_id
      → tool calls through lib/tools/executor.ts now:
          - check `requiresApproval` → create a pending approval_requests row and STOP if gated
          - check `isSimulation` → skip the real handler, return a labeled simulated result
  → Response, exactly as before
```

### Data model — tenants

- **`tenants`** — one row per company. A single well-known row (`00000000-0000-0000-0000-000000000001`, kind `'internal'`) represents Temo's own corporate operation (Section 13: Temo running its own real projects — market research, content, R&D). Every other row is a client company (kind `'client'`).
- **`tenant_members`** — links `auth.users` to tenants with a role (`owner`/`admin`/`member`). A user can belong to multiple tenants (staff case); a normal client user belongs to exactly one.
- **Auto-provisioning** (`provision_tenant_for_new_user()` trigger on `auth.users`): the very first person ever to sign up becomes the internal tenant's owner. Every signup after that gets their own new client tenant, a `client_profiles` row, and a `free` package entitlement — automatically, no manual step.
- **Shared workforce, isolated data** (Section 15, explicit): `agent_registry`/`agent_departments` remain global, un-tenant-scoped — the same Nova/Flow/Atlas/Luna/Echo/Orion hierarchy serves every tenant. Only DATA is isolated: missions, mission_objectives, mission_tasks, mission_timeline (via mission_id join), conversations, messages, memories, memory_embeddings (via memory_id join), and usage_ledger all carry or join to `tenant_id`.
- **Legacy data migration**: every row that existed before this migration was backfilled to the internal tenant (not deleted, not orphaned) — see `supabase/migrations/20260819140000_create_v1_corporate_os_foundation.sql`'s UPDATE statements.

### Security model (Section 7) — what actually changed

- **Real Supabase Auth** is now required. `lib/supabase/client.ts` persists sessions (`persistSession: true`); a global `AuthGate` (`components/auth/auth-gate.tsx`, wired into `Providers`) redirects to `/login` (`app/login/page.tsx`) whenever there's no session. There is no more anonymous/no-auth mode.
- **RLS was tightened everywhere.** Every table that previously granted `anon, authenticated` full access now grants `authenticated` only, and tenant-scoped tables additionally require `is_tenant_member(tenant_id)` (a `SECURITY DEFINER` SQL function). This was a genuine breaking change to existing policies — justified explicitly by Section 7 ("remove the assumption of a single anonymous tenant... never weaken security").
- **New, important nuance discovered during implementation**: `lib/supabase/client.ts`'s shared client is now context-aware — in the browser it carries the signed-in user's session (RLS applies normally); in any server context (Next.js API routes, the task queue processor) it automatically uses `SUPABASE_SERVICE_ROLE_KEY` instead, matching how Edge Functions already worked. This was necessary because the existing service layer (`missionService.ts`, `agentRegistryService.ts`, `executionLayer.ts`, etc.) all import one shared client singleton with no per-call injection — making it context-aware avoided a broad, invasive refactor of every DB-calling function. **The tradeoff**: RLS is no longer a backstop for server-side code, so **every API route touching tenant-scoped or sensitive data now performs its own authorization check** via `requireUser()` (`lib/auth/apiAuth.ts`), which verifies the caller's bearer token (attached by `lib/api/authFetch.ts` on the frontend). This was applied to the agent registry's mutating routes (POST/PATCH/DELETE); the pre-existing read-only GET routes were left as-is (already anonymously-readable before this migration, so not a regression) — **hardening the remaining GET routes is a known V1.1 follow-up**, not done here for scope reasons.
- **Secrets discipline unchanged and reinforced**: `SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js never inlines it into the browser bundle — verified by the `isServer` guard in `lib/supabase/client.ts` being genuinely unreachable client-side.

### Approval gates (Section 8)

`lib/governance/approvals.ts` — `requestApproval()` / `resolveApproval()` / `listPendingApprovals()`, backed by the new `approval_requests` table (append/update-only, no DELETE policy — same audit-friendly pattern as `usage_ledger`). Wired directly into `lib/tools/executor.ts`: any `ToolDefinition` with `requiresApproval: true` stops before running and creates a pending request instead of executing; the caller sees `pendingApprovalId` in the result rather than a success or a hard failure. Marked so far: `n8n.deleteWorkflow`, `memory.forget` (both destructive per Section 8's own examples). A Settings → **Approvals** page lists pending requests with Approve/Reject actions. **Not yet wired**: spend-threshold or publish-content gates for actions that aren't routed through the tool executor (e.g. a future direct-publish integration) — the mechanism is generic and ready for that, but no such integration exists yet to gate.

### Package entitlements (Section 14)

`packages` (free/package1/package2/package3/custom, seeded) + `tenant_entitlements` (package_id, credits_remaining, projects_used) + `lib/governance/entitlements.ts`'s `checkEntitlement()`/`consumeProjectSlot()`, called from `missionEngine.launchMission()` before any mission is created. Simulation missions are explicitly exempt (they don't consume a client's allowance — Section 12). Billing itself is explicitly NOT built (Section 14: "do not build a complex payment system unless necessary for V1") — entitlements can be adjusted by hand or by a future Stripe webhook writing into `tenant_entitlements` without this check changing at all.

### Budget governance (Section 9)

`budgets` (tenant_id, monthly_limit_usd, alert_threshold_pct) + `usage_ledger.tenant_id` (added) + `lib/governance/entitlements.ts`'s `checkBudget()`, which sums `usage_ledger.estimated_cost` for the tenant's current billing period against its limit. **Not yet wired to actually block spend** — it's queryable but nothing calls it as a hard gate before an AI call yet (that would mean threading a budget check into `chatWithFallback`, the single highest-fan-in function in the codebase — deferred as a V1.1 item to avoid touching that function under this mission's time budget; the read path is fully functional today).

### Simulation / R&D (Section 12)

`missions.is_simulation` (boolean). A simulation mission runs through the exact same pipeline as a real one — same planning, same delegation, same LLM calls — but `lib/tools/executor.ts` short-circuits any tool call with `simulated: true` and a labeled mock result instead of touching a real external system (n8n, memory deletion, etc.), and it's exempt from entitlement consumption. **Promotion concept** (simulation → evaluation → review → approved → production) is represented structurally (a simulation mission's `lessons_learned` rows can be reviewed and a human can then launch the same request as a real mission) but there is no automated promotion pipeline — that remains a human decision, deliberately, per Section 12's explicit "must NOT allow uncontrolled autonomous modification."

### Organizational learning (Section 11)

`lessons_learned` (tenant_id, mission_id, category, summary, outcome) — append-only, same pattern as `usage_ledger`/`approval_requests`. **Not yet auto-populated** — no code currently writes a lesson at mission completion. The table and RLS exist; wiring `missionEngine`'s completion path to write a summary via an LLM call is the natural next step, deferred (V1.1) to keep this mission's LLM-call surface area from growing further without live verification capacity to test it (see Known Limitations).

### Client AI Account Manager + multilingual (Sections 15–16)

`client_profiles` (tenant_id, assistant_name, preferred_language) — pure configuration, not a new agent implementation. `lib/governance/clientProfile.ts`'s `buildIdentityDirective()` appends a short instruction to every agent's system prompt in `lib/crew/crew-coordinator.ts` (`generateResponse`/`generateToolResponse`/`generateStreamResponse`) when a tenant has customized their assistant's name or language — the underlying role/capabilities are untouched, only the persona presentation changes. Settings → **Workspace & Language** lets a signed-in user edit both. Two languages seeded (English, Arabic per Section 16); adding more is a matter of extending the `LANGUAGE_NAMES` map and the Settings dropdown — no business logic duplication per language, as required.

### Background task queue (Section 5)

The synchronous path (one mission, one HTTP/chat request, in-process execution) remains the PRIMARY path and is unchanged — it already works and is tenant-correct under RLS via the browser's session. Added on top: `claim_ready_tasks(limit, claimer)` — a `SECURITY DEFINER` Postgres function using `FOR UPDATE SKIP LOCKED` to atomically claim a batch of `'ready'` tasks (new `mission_tasks.locked_at`/`locked_by` columns prevent double-processing under concurrent callers) — plus `POST /api/tasks/process`, which claims a batch and runs each through the exact same `executeTask()` the synchronous path uses (zero duplicated execution logic). **This is a genuine architectural upgrade path, not fully activated**: `pg_cron`/`pg_net` are enabled defensively in the migration (wrapped so the migration still succeeds if the project's plan doesn't expose them), but no cron schedule was created, because doing so would need to target a stable deployed HTTPS URL — unreachable from a local dev server. **To activate it after deployment**: schedule `select cron.schedule('process-task-queue', '*/1 * * * *', $$ select net.http_post('https://<deployed-url>/api/tasks/process', headers := '{"x-queue-secret":"<TASK_QUEUE_SECRET>"}'::jsonb) $$);` — documented here rather than embedded in a migration so no deployment URL or secret ever lands in version control.

### Live verification results (confirmed against the real Supabase project)

- **Signup → auto-provisioning, both branches**: verified via Playwright + the Supabase Admin API. First signup correctly became the internal tenant's owner (`tenant_members` row, role `owner`, tenant `00000000-...0001`); a second signup correctly received its own new client tenant, a `free`-package `tenant_entitlements` row with 20 credits, and a `client_profiles` row — all exactly as designed, with zero manual steps.
- **A real bug was found and fixed during this verification**: the provisioning trigger initially failed every signup with "Database error saving new user" — an unqualified-`search_path` issue when a `SECURITY DEFINER` trigger fires from `auth.users`' context (a known Supabase gotcha). Fixed via `supabase/migrations/20260819150000_fix_tenant_provisioning_search_path.sql`, which also added exception-safety (a provisioning failure must never block signup) and an idempotent client-side repair path (`ensure_tenant_for_current_user()`, called by `authStore.refreshTenants()` if a signed-in user has zero tenant memberships).
- **Login, session, and the auth gate**: confirmed working — a confirmed user signs in and lands on `/dashboard`.
- **G-Brain**: confirmed rendering with real tenant-visible data (5 active managers: NOVA/FLOW/ATLAS/LUNA/ECHO — Orion correctly excluded as inactive) and correct neural-line depth ordering (`org-lines` z-index 1, `org-tree` z-index 2, verified via computed styles, not just source reading).
- **Command Deck**: confirmed rendering 5 real agent cards, consistent with G-Brain.
- **Agent Management (Settings)**: confirmed a full real create → verify-visible → delete cycle against the live database via the UI, including cleanup of the manager's `children_ids` — not a mock.
- **Workspace & Language and Approvals settings sections**: confirmed rendering and reachable.
- **RLS tenant isolation**: confirmed via direct REST calls with the anon key — `agent_registry`, `missions`, `conversations`, `memories`, `usage_ledger`, and `packages` all now return an empty result to an unauthenticated caller (previously fully open). This is the concrete, verified proof that Section 7's "remove the single-anonymous-tenant assumption" was actually achieved, not just written into a migration file.
- Test data (2 auth users, 1 test tenant, 1 test worker agent) created during verification was fully cleaned up afterward — the internal tenant's ownership slot was deliberately released so the real owner's first signup claims it correctly.

### Known limitations (V1, honestly stated)

- **No AI provider API key was configured in the live project during this mission**, so no real LLM-backed mission response was generated end-to-end — mission *creation*, entitlement checks, tenant scoping, and delegation routing are all code-verified and (where reachable without an LLM call) live-verified, but the final "AI writes the actual answer" step was not exercised live.
- Budget checks (`checkBudget`) are not yet a hard gate before spend.
- `lessons_learned` is not yet auto-populated from completed missions.
- The background queue is schema/code-complete but not scheduled (needs a deployed URL).
- Only the 4 agent-registry mutating routes got explicit `requireUser()` hardening; other server routes reading tenant-adjacent data should be audited next (V1.1).
- No OAuth-based tool integrations (Gmail/Drive/GitHub/Calendar) were added — judged, per Section 17's own "only add if it materially improves V1" instruction, that partially-built OAuth flows without live testing capacity would be a worse outcome than clearly documenting them as not done. n8n (already real) remains the primary external-action integration.
- Multilingual coverage is the persona/response layer only — the UI's own strings (buttons, labels) are still English-only; no RTL layout support was added for Arabic.

## V1.1 — CORPORATE OFFICE / OPERATING COMPANIES STRUCTURE + UI/UX ENHANCEMENT PASS

Two related pieces of work, done back-to-back: (1) a genuine data-model addition — an internal Corporate Office / Operating Companies grouping layer above the existing shared agent registry — and (2) a visual enhancement pass across G-Brain and Command Deck to make that structure (and the rest of the interface) read as a premium, cohesive Corporate AI OS rather than a flat agent list. Both are additive; nothing described in Section "V1 — CORPORATE AI OS / AI AGENCY FOUNDATION" above was changed or removed.

### 1. Data model: `business_units` (new table)

A new internal grouping concept, deliberately **not** named `companies` — `tenants` (Section "V1", above) already means "external client company" in this codebase, and reusing that word for an internal concept would create exactly the kind of ambiguity this document exists to prevent.

- **`business_units`** (`id`, `name`, `kind: 'corporate' | 'operating'`, `description`, `icon`, `theme_color`, `sort_order`) — same RLS pattern as `agent_registry`/`agent_departments` (`authenticated`-only SELECT/INSERT/UPDATE, no DELETE policy — deletes go through a service-role server route if ever needed, matching the existing agent-delete pattern).
- **`agent_departments.business_unit_id`** (new nullable FK) — links every existing department to its business unit. Purely additive column.
- Migration: `supabase/migrations/20260819160000_create_business_units.sql`. Idempotent (`ON CONFLICT ... DO UPDATE`), applied and live-verified against the real Supabase project (service-role REST queries confirmed the table, the FK backfill, and the new agent rows before any UI work began).

**Seed structure — one business unit per existing manager, plus a new Corporate Office:**

| Business unit | `kind` | Manager(s) |
|---|---|---|
| Corporate Office | `corporate` | 5 new agents (below) |
| AI Engineering & Technology | `operating` | Nova (existing, unchanged) |
| AI Automation | `operating` | Flow (existing, unchanged) |
| AI Research & Intelligence | `operating` | Atlas (existing, unchanged) |
| AI Design & Creative | `operating` | Luna (existing, unchanged) |
| AI Marketing & Content | `operating` | Echo (existing, unchanged) |
| Trading Company | `operating` | Orion (existing, unchanged — still `is_active=false`, not reactivated by this work) |

**5 new Corporate Office agents** (new identities, not replacements — every existing manager keeps its original `id`, `role`, capabilities, and workers exactly as before): **Vertex** (Chief Strategy Officer), **Forge** (Chief Innovation Officer), **Sentinel** (Chief Governance & Risk Officer), **Cortex** (Chief Corporate Intelligence Officer — deliberately distinct from Atlas, who remains the Research operating company's day-to-day manager), **Ledger** (Chief Financial Officer). All are ordinary `agent_registry` rows (`level='manager'`, `parent_id='temo'`) — no new `agent_level` enum value was added; the corporate/operating visual and semantic distinction comes entirely from `business_units.kind`, keeping the existing hierarchy model (Section 3) unchanged. A new `gold` tone (`#facc15`) was added to `TONE_COLORS` in `lib/agents/frontendBridge.ts`, reserved for the Corporate Office tier so it reads as visually distinct from the operating-company rainbow.

**Service layer**: `lib/agents/agentRegistryService.ts` gained `loadBusinessUnits()` / `loadBusinessUnitsWithDepartments()`, mirroring the existing `loadDepartmentsWithAgents()` pattern exactly. `lib/agents/types.ts` gained `BusinessUnitRecord` / `BusinessUnitWithDepartments`; `DepartmentRecord` gained `businessUnitId`. Both G-Brain and Command Deck fall back to today's flat, ungrouped rendering if `business_units` is ever unreachable — verified live (pre-migration screenshots showed the identical flat layout with zero console errors) before the migration was applied.

### 2. G-Brain visual redesign (`components/temo/org-chart.tsx`)

- **Temo is now visually dominant**: a new `hero` Holo size (198px, up from the existing `xl` 134px), 32px name (up from 26px), and — new — a short description line pulled from `TEMO_UI.activity`. No other agent uses the `hero` size.
- **Corporate Office / Operating Company grouping bands**: managers now render inside labeled clusters (`business-unit-row` → `business-unit-cluster`, one per business unit) with a pill-shaped header (icon + name, tinted with the unit's real `theme_color`) above each cluster's manager(s), instead of one flat, unlabeled row of 10 managers. This is the direct visual expression of the data model in §1. The Corporate Office cluster gets a subtle extra background wash (`.cluster-corporate`) to reinforce its distinct executive status, on top of the gold tone already carried by its agents.
- **Every manager/executive node now shows**: avatar (unchanged, existing `Holo` component), name, fixed job title, **company/business-unit tag** (new — `agent.company`, sourced from the same business-unit data, not fabricated), status dot, and a **short description snippet** (new — the agent's real `description` column, 2-line clamp with ellipsis). Worker/sub-agent nodes deliberately keep their existing compact treatment (avatar + name + status only) — adding a full description to every worker as well was judged to reintroduce the "crowded" look the brief explicitly warned against; this is a scoping decision, not an oversight, and is easy to extend later if wanted.
- **Decrowding**: `.subagent-stack` changed from a strict single-column vertical stack to a CSS `flex-flow: column wrap` layout (`max-height: 280px`) — companies with more than ~2 workers now wrap into a second column automatically instead of growing arbitrarily tall, with zero JS changes (the SVG edge-drawing code already measures actual DOM positions via `getBoundingClientRect`, so it required no changes to support the new layout).
- **Depth/paint order, neural-line behavior, and the starfield/background** are unchanged from the prior pass — still verified (lines render behind nodes/text at every viewport tested).
- **Responsive/scrolling**: `.business-unit-row` is a single non-wrapping flex row (`flex-wrap: nowrap`) inside the pre-existing `.org-stage` horizontal scroll container — verified by scrolling the container to `scrollWidth` and confirming Corporate Office's 5 executives render correctly off the right edge of a 1920px viewport, and by a 900px-viewport screenshot confirming the layout degrades to a legible horizontally-scrollable strip rather than breaking.
- **Agent detail modal** (`DepartmentModal`) — unrelated to this pass but confirmed still fully functional: capabilities/tools chips and real recent-task activity (added in the prior business-units turn) render correctly for both an original agent (Nova) and a new Corporate Office agent (Vertex).

### 3. Command Deck panel reorder + declutter (`components/temo/command-deck.tsx`)

Right-rail panels were reordered to match the brief's explicit priority (system status → corporate overview/companies → approvals → AI usage/resources), and each now shows real data instead of decoration:

- **"Corporate Overview"** (renamed from "Global Operations") — leads with real counts (companies, managers, active missions) from `loadBusinessUnitsWithDepartments()` / mission data; the previous purely-decorative large network icon was removed as clutter now that the real numbers carry the panel.
- **"Approvals"** (renamed from "System Alerts") — real pending rows from `listPendingApprovals()`; gets a visible amber `panel-attention` treatment (border/glow + pulsing signal dot) only when there is at least one pending approval, otherwise reads as calm/normal. Empty state is an honest "No pending approvals." — never a fabricated alert.
- **"AI Usage & Resources"** (renamed from "Resource Distribution") — real per-provider token/cost breakdown (`getUsageBreakdownByProvider()`, new function in `lib/ai/usageLedger.ts`) driving both the donut chart and its legend; empty state is an honest "No AI usage recorded yet." rather than the old hardcoded 48/24/18/10% split.
- Each agent card in the hero-bridge row now carries its business-unit name as a small tag underneath the role, for the same "which company is this agent part of" context G-Brain now shows.
- Global polish: a consistent `:focus-visible` ring across nodes/cards/nav buttons/links (keyboard-navigation parity, previously inconsistent), a subtle hover glow on `.hologram-panel`, and `.agent-card` transition smoothing.

### 4. Explicitly preserved (verified, not just assumed)

- Every existing agent's `id`, `role`, capabilities, tools, and worker list — byte-for-byte unchanged (confirmed via direct service-role REST query before and after).
- The cinematic background, starfield, particle/scan animations, neural-link SVG rendering and its depth ordering, and the `Holo`/`VoiceAura` shared avatar components — all reused as-is, not rebuilt.
- Multi-tenancy, RLS, auth, mission engine, tool executor, approval-gate mechanics — untouched; this was a presentation-layer and one-table-additive-schema pass only.
- No hardcoded organizational data was introduced into the UI layer — every number/label shown (company counts, agent counts, mission counts, usage figures, approval counts) is read live from the database, with an honest empty state where real data doesn't exist yet (no AI usage recorded, no pending approvals, no missions), consistent with the brief's "no fake metrics" constraint.

### 5. Known remaining UI limitations (honestly stated)

- Agent-card title/company text can wrap to an uneven number of lines across a row when names differ significantly in length (e.g. "Research & Intelligence Manager" vs. "Nova"), producing slightly uneven card heights in the Command Deck hero row. Cosmetic, not functional — a fixed-height card with truncation would resolve it, not done here for scope.
- Worker-grid wrapping (`flex-flow: column wrap`) is a CSS-only solution tuned for the current worker counts (2–5 per manager); if a manager is ever given a much larger number of workers, the fixed `max-height: 280px` heuristic may need to become responsive rather than a constant.
- Corporate Office's band, at 5 managers, is visibly wider than each single-manager Operating Company band — intentional (reflects real headcount) but worth a design pass later if Operating Companies grow multiple departments each, per the target model in Section 9 above ("each company can have its own departments, managers and workers").
- No dedicated Level-2 "Company" drill-down route was built (e.g. `/company/[id]`) — clicking a business-unit band does not currently scope/filter the view. The band grouping on the existing G-Brain page was judged sufficient for the current company count (7); a dedicated route remains a natural next step if the number of companies grows enough that a single-page view becomes unwieldy.
- The rest of the app (Settings, Agents, Missions, Analytics, etc. — the `AppShell`-wrapped utility pages, a deliberately separate visual system from G-Brain/Command Deck per Section 2's table) was **not** touched by this pass; the brief's "global UI/UX" instructions were applied to the cinematic G-Brain/Command Deck surface specifically, since that's where the Corporate/Company narrative lives. Extending the same design-system polish (focus rings, hover states, spacing) to the utility pages is a reasonable follow-up.

## V1.2 — UI/UX POLISH & STRUCTURAL ALIGNMENT PASS (2026-08-20)

A "Lead UI/UX Engineer" pass across G-Brain, Command Deck, and global
styling, on top of the V1.1 Corporate Office / Operating Companies
structure. Purely presentation-layer plus one naming-only migration — no
backend, schema (beyond a `name` column update), auth, or agent-hierarchy
changes.

### 1. G-Brain layout — Corporate Office now flanks Temo directly

Previously Corporate Office was just another band at the end of the
scrollable Operating-Company row. It now renders as two flanking columns
(`.executive-flank.flank-left` / `.flank-right`) directly beside Temo at
the top tier — alternating agents left/right so headcount stays balanced
as it grows — with the 6 Operating Companies remaining in their own row
below. Both flanks use CSS `flex-wrap`, so additional future Corporate
Office hires stack within their column instead of pushing off-screen. At
today's headcount (10 managers, 7 companies) the entire chart now fits in
one 1920px viewport with no horizontal scroll at all (it still scrolls
gracefully at narrower widths, verified). The `Node`/edge-measurement code
was not touched — only where in the DOM the same nodes render, since edge
positions are computed from live `getBoundingClientRect()` calls regardless
of layout position.

### 2. Subsidiary naming convention

New migration `20260820090000_business_unit_naming_convention.sql` appends
"Company" to every `kind='operating'` business unit's name (e.g. "AI
Automation" → "AI Automation Company"). Corporate Office is deliberately
excluded — it is the parent/governing body, not a subsidiary. `id` values,
`kind`, colors, and icons are untouched; this is a pure `name` UPDATE.

### 3. Color harmony fixed at its actual source

Root cause found: `TONE_COLORS` (`lib/agents/frontendBridge.ts`) held
decorative shades (e.g. violet `#a78bfa`) that were close to but NOT the
same hex as the corresponding `business_units.theme_color`/agent
`theme_color` (e.g. `#7B61FF`) — so a company's band header, its manager's
node border/glow, and the connecting neural line were three visibly
different purples instead of one. Fixed by making `TONE_COLORS` exactly
equal each company's real stored hex (not a nearby approximation), and
adding a missing `orange` tone — `TONE_MAP` had been silently collapsing
Trading Company's `#F97316` onto the same `amber` bucket as Marketing's
`#F59E0B`. Because band headers, node borders, edges, and Command Deck
cards all already read from this one `TONE_COLORS` map, the fix cascades
correctly everywhere with no other code changes — exactly the "single
source of truth" pattern this document keeps enforcing.

### 4. Distinctive avatars for Corporate Office

The 5 new corporate agents (Vertex/Forge/Sentinel/Cortex/Ledger) had no
portrait assets and rendered as a bare fallback letter. `agentImage()` now
assigns each one a distinct image from the same real specialist-portrait
pool workers already use (`/agents/sub-01.png`...) — reusing true existing
assets, not fabricating new ones.

### 5. Command Deck — dead widgets purged, real hub added

Audited every widget in the old `widget-grid`: `ChatWidget` (canned string
response, not connected to the real chat pipeline — `/chat` already does
this for real), `NetworkWidget` (hardcoded 5-slot radial layout, silently
dropped half of today's 10 managers, duplicated the hero-bridge row above
it), `WorkflowWidget`/`AnalyticsWidget`/`SettingsWidget` (100% local state,
zero backend connection, each duplicating a real page that already exists
at `/workflows`/`/analytics`/`/settings`) — all removed. `MissionWidget`
kept (its mission list is real, from `listMissions()`) but its static
always-"3-done" progress timeline (never reflected any real mission) was
removed. A fabricated `"Knowledge Size: 2.4TB"` sidebar stat was replaced
with the real live company count. The right-rail's "System Overview" panel
(a hardcoded, never-changing fake sine-wave "Real-time Performance 100%"
chart) was removed outright — no real time-series metric exists to back
it, so per this document's own "no fake metrics" rule it was deleted
rather than left in place or backed by an invented number.

In place of the removed widgets: a new **Quick Access** panel renders
every real page in the app as a clickable tile, reusing `LeftNav`'s own
`NAV_ITEMS` array (now exported) as the single source of truth — Command
Deck's hub and the AppShell sidebar can never drift out of sync because
they're now the same list. `LeftNav.NAV_ITEMS` itself was corrected in the
process: `/` was mislabeled "Dashboard" (it's actually G-Brain) and
Command Deck (`/dashboard`) was missing from the menu entirely — both
fixed.

### 6. Live Command Bridge mirrors G-Brain's real structure

The hero-bridge agent row was a flat list with no company grouping. It now
groups agents into the same Corporate Office / Operating Company clusters
as G-Brain, computed from the exact same live queries
(`loadBusinessUnitsWithDepartments()`), each cluster carrying the same
company-color label. This is a *genuine* mirror, not a hand-synced
lookalike: both surfaces read the identical database tables, so a real
structural change (a new company, a reassigned manager) appears in both
places automatically with no additional code path to keep in sync. A real
layout bug was found and fixed during verification: the taller
label-bearing cluster rows initially collided with Temo's own name/subtitle
text at the container's default height — fixed by increasing
`.hero-bridge`'s height and Temo's vertical position (verified via
`getBoundingClientRect()` measurements before/after, not just visually).

### 7. "Tap to Speak" brought to the primary surfaces

`VoiceHud` (`components/layout/voice-hud.tsx`) was already a fully real,
wired voice control (`voiceManager`/`useVoiceStore`) — but it only existed
inside `TopNav`, part of the separate `AppShell` page family (`/chat`,
`/settings`, etc.). G-Brain and Command Deck, the two primary cinematic
surfaces, had no voice trigger at all. The exact same component (not a
re-styled duplicate) is now rendered in Command Deck's topbar, next to the
G-Brain link — real, prominent, and it does not overlap or obstruct any
other topbar control.

### 8. Root-cause contrast fix (not another per-component patch)

The dark-text bug patched per-component in the previous UI pass
(`components/ui/input.tsx`, `app/settings/page.tsx`) had a systemic root
cause never fixed at the source: `app/globals.css` defines `--foreground`
twice — once correctly as an HSL triplet inside `@layer base` (line 11),
and again, unlayered, as a raw hex string (`#e7f6ff`, near line 960).
Unlayered rules always win over `@layer` rules regardless of source order
in CSS's cascade-layer model, so the hex value was winning everywhere,
making Tailwind's `text-foreground` utility compile to the invalid
`hsl(#e7f6ff)` app-wide — not just on the two pages previously patched.
Fixed at the source: the unlayered `:root` now sets `--foreground` to a
valid HSL triplet (`203 100% 95%`, matching the same visual color). A
scripted Playwright sweep across all 13 real pages (leaf DOM nodes with
near-black computed `color`) came back clean afterward, with the sole flag
being a correctly-designed dark-text-on-bright-gradient avatar chip (a
false positive, verified by design, not a bug).

### Known remaining limitations (honestly stated)

- The naming migration (item 2) must still be applied by the project owner
  via the Supabase SQL editor — `.claude/_apply_business_unit_naming.sql`
  — the same manual-apply pattern every migration in this project has used
  (no `psql`/Supabase CLI is available in this environment). Until then,
  operating-company labels read without "Company" appended.
- A meaningful amount of now-genuinely-dead CSS (`.chat-log`, `.network-map`,
  `.workflow-map`, `.tabs`, `.bars`, `.theme-swatches`, `.slider-row`, etc.)
  supporting the removed Command Deck widgets was left in place rather than
  hand-edited out of a very long pre-existing minified CSS line — it matches
  no current DOM, so it's inert, but a future pass could remove it for
  file-size hygiene.
- Item 7's "unify... site-wide" was addressed at its most impactful point
  (the shared `--foreground` root cause, verified across all 13 pages) and
  via the reused `NAV_ITEMS`/`VoiceHud` components; a full line-by-line
  visual redesign of the separate `AppShell` page family (spacing, card
  proportions, icon consistency beyond what's shared) was not attempted in
  this pass — those pages were already internally consistent with each
  other, just a distinct (and, per the brief, deliberately-preserved)
  visual system from G-Brain/Command Deck.
- Settings → Profile shows placeholder account data ("Alex Rivera",
  Pro plan) unrelated to the real signed-in user — pre-existing, unrelated
  to this pass's scope, noted for awareness.

## V1.3 — MASTER COMPLETION & PRODUCTION-READINESS PASS (2026-08-20)

A backend-reliability, security, and correctness pass across the full
runtime — task queue, budget governance, organizational learning, the
memory/RAG tenant-isolation layer, and simulation mode — following the
17-section Master Completion Mission brief. No UI redesign; the one UI
change is a small, functional simulation-mode toggle (item 6 below). All
changes are additive; no existing agent, worker, department, or company was
renamed, removed, or reassigned.

### 1. Task queue reliability (double execution, abandoned locks, silent loss)

- `claimTask()` (`lib/swarm/missionService.ts`) does an atomic conditional
  `UPDATE ... WHERE status IN ('ready','waiting')`, returning `null` if
  another caller already claimed the row. `executeTask()`
  (`lib/swarm/executionLayer.ts`) now calls this as its first step instead
  of an unconditional `updateTask(..., {status:'running'})` — this closes a
  real double-execution race between the synchronous mission pipeline and
  the background `/api/tasks/process` queue processor picking up the same
  task. A losing caller returns a new `status: 'cancelled'` `ExecutionResult`
  (the `'cancelled'` value existed in the type but was previously unused
  anywhere in the codebase).
- `app/api/tasks/process/route.ts`: a task whose parent mission no longer
  exists was previously left `status:'ready'` with a stale lock forever,
  silently re-claimed and silently skipped on every future run (infinite,
  invisible retry loop). It's now marked `'failed'` with an explicit error
  message on first encounter.
- `recalculateProgress()` (exported from `missionEngine.ts`, previously
  private) is now called from the queue route after every `executeTask()`
  call. Previously only the synchronous pipeline rolled task-status changes
  up into the mission's `status`/`progress` columns — a mission worked
  exclusively through the background queue could finish every task and stay
  stuck at `status:'executing'` forever. Both execution paths now converge
  on the same rollup logic.
- New migration `supabase/migrations/20260820100000_reclaim_stale_running_tasks.sql`
  extends `claim_ready_tasks()` to sweep tasks stuck in `status:'running'`
  for more than 10 minutes (a crashed executor scenario `claim_ready_tasks()`
  never handled — it only reclaimed stale `'ready'` locks): retried if
  under `max_retries`, otherwise marked `'failed'` with an explanatory
  message. **Not yet applied** — see "Deployment requirements" below.
- `app/api/tasks/process/route.ts`'s `x-queue-secret` check was fail-open:
  if `TASK_QUEUE_SECRET` was ever unset, the entire check was skipped and
  the route ran fully unauthenticated with service-role privileges. Changed
  to fail-closed (missing secret now always 401s).

### 2. Budget hard-gate (Section 3C)

`checkBudget()` (`lib/governance/entitlements.ts`) existed but was never
called anywhere. It's now a real pre-spend gate in `launchMission()`
(`lib/swarm/missionEngine.ts`), checked alongside the existing entitlement
check, before any objectives/tasks are created. Applies even to simulation
missions — `isSimulation` only blocks *tool* side effects
(`lib/tools/executor.ts`); it still makes real, billable AI provider calls.
Tenants with no `budgets` row configured are unaffected (`checkBudget`
returns `withinBudget: true` when no limit is set) — this cannot newly
block anyone who hasn't opted into a budget. No pricing was invented;
`checkBudget` sums real `usage_ledger.estimated_cost` rows for the current
period against the tenant's configured `monthly_limit_usd`.

### 3. Organizational learning — `lessons_learned` wired (Section 3E)

The `lessons_learned` table existed with zero application code referencing
it. `recordLesson()` (`lib/swarm/missionService.ts`) is now called from
`recalculateProgress()` at exactly two points: a mission that fully fails
(`outcome: 'failure'`), and a mission that completes with at least one
failed task (`outcome: 'partial'`) — never on a fully clean success, per the
brief's explicit "do not generate meaningless automatic memories for every
operation." Each entry captures up to 5 real task error messages, not a
generic summary.

### 4. Memory/RAG tenant isolation — a confirmed data-integrity bug and a confirmed security leak, both fixed

Two independent, verified findings, both rooted in the same gap: the entire
`lib/memory/*` + `lib/knowledge/*` subsystem was 100% tenant-unaware end to
end (zero references to `tenantId`/`tenant_id` anywhere in either
directory), even though the V1 migration (`20260819140000`) made
`memories.tenant_id` and `conversations.tenant_id` `NOT NULL` months ago.

- **Correctness bug**: `memoryStore.store()` and `ConversationService.createConversation()`
  inserted into `memories`/`conversations` without `tenant_id` at all —
  every real memory-store call and every new conversation creation would
  violate the `NOT NULL` constraint in production. Fixed by threading a
  `tenantId` field through the full call chain: `StoreMemoryInput`,
  `SearchParams` (both `lib/memory/types.ts` and `lib/knowledge/types.ts`),
  and every intermediate wrapper (`memoryService`, `shortTermMemory`,
  `longTermMemory`, `episodicMemory`, `retrievalService`, `semanticSearch`,
  the Knowledge Engine, `supabaseProviders`) down to the two physical
  insert sites, plus `ConversationService.createConversation` /
  `CrewCoordinator.startConversation`. Real entry points (the tool executor,
  which already carries `mission.tenantId` end-to-end; `crew-coordinator.ts`,
  which already reads `useAuthStore.getState().currentTenantId`) now pass
  the real tenant. Paths with no tenant in scope fall back to the internal
  tenant constant (`00000000-0000-0000-0000-000000000001`, the same
  fail-open constant already used elsewhere in this codebase) rather than
  throwing — this guarantees no regression while real attribution is used
  wherever it's available.
- **Security leak**: `match_memories()` (`supabase/migrations/20260727112722`)
  is `SECURITY DEFINER` — it bypasses RLS by definition — with no tenant
  filter at all. Any authenticated user's semantic memory search returned
  every tenant's matching memories, not just their own; RLS on the
  underlying tables was correctly configured but this function routed
  around it entirely. New migration
  `supabase/migrations/20260820110000_fix_match_memories_tenant_leak.sql`
  adds a required `filter_tenant_id` parameter (no default — no caller can
  silently omit it) and filters on it. The client-side call
  (`memoryStore.semanticSearch()`) was updated in the same change to always
  pass it. **This migration and the client code change are coupled and
  must be deployed together** — see "Deployment requirements" below;
  deploying the code without the migration (or vice versa) will error on
  every semantic search call until both land (semantic search fails
  gracefully into keyword-only results in `hybrid` mode; a direct
  `mode:'semantic'` caller would see the RPC error).
- **Not yet applied**: both migrations above are DDL — this repository has
  no `supabase login`/`SUPABASE_ACCESS_TOKEN` configured in this
  environment, so `CREATE OR REPLACE FUNCTION` cannot be applied via the
  PostgREST DML trick used for the V1.2 naming migration. The project owner
  must run them via the Supabase SQL editor (or `supabase db push` after
  `supabase login`).

### 5. Embedding dimension safety (Section 4)

`memory_embeddings.embedding` is a fixed `vector(3072)` column (sized for
Gemini's `gemini-embedding-001`). Switching `embedding_provider`/
`embedding_model` in Settings to a provider with a different native
dimension (OpenRouter's `text-embedding-3-small` at 1536, Ollama's
`nomic-embed-text` at 768, etc.) previously surfaced as a raw, unexplained
Postgres dimension-mismatch error on the next memory store — pgvector
already prevents silent corruption (it hard-errors on any width mismatch),
but the failure was uninterpretable. `embeddingService.storeEmbedding()`
(`lib/memory/embeddingService.ts`) now checks the embedding provider's own
reported dimension count (from the real API response, not a hardcoded
guess — the edge function derives it from `embeddings[0].length`) against
the expected `3072` before attempting the insert, and throws a clear,
actionable error naming the actual model/dimension involved. A proactive
UI warning in Settings (before the user even tries) was considered but not
built — it would require hardcoding each model's native dimension from
memory rather than a verified source, which risks being wrong in a way
that misleads rather than helps; the runtime check (grounded in the real
API response) is the correct authority here.

### 6. Simulation/R&D mode — verified, found completely unreachable, fixed end to end (Section 3F)

Verification (not assumption) found `isSimulation` had real backend
plumbing (`missionEngine` → `executionLayer` → `lib/tools/executor.ts`'s
real-side-effect gate) but was **never set from anywhere reachable by a
user** — `crew-coordinator.ts`'s `routeAndRespond()` didn't accept it,
`runSimplePipeline()` (`unifiedOrchestrator.ts`) didn't pass it, and no UI
anywhere exposed a control for it (confirmed via a full grep of `app/` — zero
matches). This meant simulation mode's core promise, "no real external side
effects," never actually applied to the chat/tool-calling pipeline that
handles most everyday interaction — only the mission pipeline's
entitlement/budget checks respected it. Fixed by threading `isSimulation`
through the same chain already used for `tenantId` in this pass
(`runSimplePipeline` → `routeAndRespond` → `runContextManager` →
`decideTools` → `ToolRequest`), and adding a real, small UI control: a
`FlaskConical` icon toggle in the shared `InputBar` component
(`components/temo/input-bar.tsx`), wired into both `/chat`
(`app/chat/page.tsx`) and Command Deck's chat dock
(`components/temo/chat-dock.tsx`) — one component, so both surfaces stay in
sync automatically. No new color was introduced; the toggle reuses the
existing `temo-purple` token.

### Real E2E verification performed (not typecheck-only)

Per the brief's explicit instruction not to claim E2E success from
typechecking alone: the dev server was started, `/chat` was driven with
real Playwright (headless Chromium) — page load confirmed clean (zero
console/page errors beyond one benign 404 and pre-existing WebGL/CSS
warnings unrelated to this pass), the simulation-mode toggle confirmed
rendering and clickable, and a real chat message was sent. This surfaced a
genuine, pre-existing, project-wide blocker unrelated to any code in this
pass: **none of the three Supabase Edge Functions (`ai-chat`, `embeddings`,
`n8n-proxy`) are currently deployed to the live project** — confirmed via
direct `curl -X OPTIONS` against each function's URL, all three returning
`404 {"code":"NOT_FOUND","message":"Requested function was not found"}`.
This means no real AI provider call, embedding call, or n8n trigger can
currently succeed in this environment regardless of any application code —
it is a deployment gap, not a code gap. Blocked on the same missing
`SUPABASE_ACCESS_TOKEN` credential noted below.

### Deployment requirements (owner action needed — none of these can be applied from this environment)

1. `supabase login` (interactive; needs a human), then:
2. `supabase functions deploy ai-chat --project-ref lqwgprudmhqsqjqoeqjt` —
   deploys both the pre-existing (never-deployed) function and this pass's
   streaming-usage-recording fix (item 7 below).
3. `supabase functions deploy embeddings --project-ref lqwgprudmhqsqjqoeqjt`
   — never deployed; pre-existing gap, not caused by this pass.
4. `supabase functions deploy n8n-proxy --project-ref lqwgprudmhqsqjqoeqjt`
   — same.
5. Apply `supabase/migrations/20260820100000_reclaim_stale_running_tasks.sql`
   and `supabase/migrations/20260820110000_fix_match_memories_tenant_leak.sql`
   via the SQL editor (both are DDL; deploy together with the code in this
   pass, not independently — see item 4's migration/code coupling note
   above).

### 7. `streamWithFallback` usage recording gap

Only the non-streaming `chatWithFallback` recorded usage to the Usage
Ledger — every streamed chat/voice response was invisible to cost
governance. Streaming provider APIs don't return exact token counts
per-chunk, so the `ai-chat` edge function now computes a char/4 estimate at
stream completion (explicitly marked `estimated: true`), emitted in the
final SSE `done` message; `streamWithFallback` (`lib/ai/ai-provider.ts`)
now records it the same way the non-streaming path always has. Requires
the `ai-chat` edge function redeploy (item 2 above) to take effect.

### Known remaining gaps (honestly stated, not fixed in this pass)

- ~~**Tool execution inside missions**~~ — Fixed by M1-01 (2026-08-25); see
  the dated section near the end of this document.
- **`memory-decision.ts`'s "remember" auto-summary merge path**
  (`summarizer.mergeMemories()`) still defaults to the internal tenant —
  `MemoryRecord` doesn't currently expose `tenantId` on read, so a merge
  can't recover the original memories' real tenant without widening that
  type; a low-traffic consolidation path, left as a known minor limitation
  rather than expanded speculatively.
- Everything under "Deployment requirements" above is written and
  typechecked but not live until the owner applies it.

### V1.3 addendum — live deployment + real E2E verification (2026-08-20, same day)

All three edge functions and both pending migrations from the section above
were deployed/applied by the project owner and independently re-verified
live (not trusted from CLI output alone — each claim was re-checked with a
direct probe: `curl -X OPTIONS` against each function, and a differential
RPC test against `match_memories`' old vs. new signature). Full detail,
including the real E2E chat/mission trace, lives in the standalone **"TEMO
AI OS — LIVE E2E VERIFICATION REPORT"** delivered to the owner. Summary of
what changed in this addendum pass:

- **`match_memories` migration bug caught before the owner ran it**: the
  original migration used `CREATE OR REPLACE FUNCTION` with a changed
  argument list — Postgres treats that as a *new, additional* overload, not
  a replacement, which would have left the vulnerable unscoped 5-argument
  version still callable side by side with the fix. Corrected to `DROP
  FUNCTION IF EXISTS` the old signature first, in both the migration file
  and a consolidated `.claude/_apply_pending_migrations_20260820.sql`
  convenience copy. Verified live afterward: the old signature now 404s,
  the new one works, and a differential test (same real embedding, two
  different `filter_tenant_id` values) proved isolation — the owning
  tenant's memory is returned, a different tenant_id returns zero rows.
- **Stale AI provider models** (found live, not in code): every configured
  model across Gemini/Groq/NVIDIA/OpenRouter had drifted to a
  provider-deprecated name, so *every* real chat call 404'd before this
  addendum, regardless of any code in this repo. Gemini's own live API
  response named its exact replacement (`gemini-3.6-flash`); that one was
  corrected in `app_settings` since it was a directly-provider-sourced fix,
  not a guess. The embedding model (`app_settings`'s sibling table,
  `memory_settings.embedding_model`) had drifted from the codebase's own
  documented default (`gemini-embedding-001`, in
  `DEFAULT_MEMORY_SETTINGS`) to a deprecated `text-embedding-004` — restored
  to the documented default rather than guessed. Groq/NVIDIA/OpenRouter
  remain on stale models; not corrected, since no equivalently-verified
  replacement name was available (see the E2E report's remaining blockers).
- **Real code bug found via live testing, not typecheck**: `knowledge`
  provider's `store()` (`lib/knowledge/supabaseProviders.ts`) — the primary
  path for "remember X" requests — created a real memory row but never
  generated an embedding, unlike `lib/memory/longTermMemory.ts`'s separate
  store path. Fixed by adding the same settings-gated, non-fatal embedding
  call `longTermMemory.store()` already used. Verified live: embedding
  generated and stored, and a follow-up "what is X" question correctly
  recalled it via real semantic search.
- **Real code bug found via live testing**: `lib/swarm/managerContext.ts`'s
  `listAvailableWorkflows()` queried `workflow_registry.name` and
  `.eq('is_active', true)` — neither column exists (the real schema has
  `workflow_name`/`active`, confirmed against the migration that created
  the table). Fixed to match the real schema.
- **Real mission E2E trace confirmed live**, not inferred: a genuine user
  message ("List my n8n workflows") produced a real `missions` row →
  dispatched to the real `flow` (Automation) manager → two real
  `mission_tasks` rows, each showing `Context Building: Success` /
  `LLM Execution: Success` → mission rolled up to `status:'completed',
  progress:100` via the `recalculateProgress()` fix from the section above
  → `usage_ledger` rows correctly attributed to the real `mission_id` and
  `manager_id`. The simulation-mode toggle's `is_simulation` flag was
  confirmed persisted correctly (`true`) on these mission records.
- **No fake tenant data was created** to test the `match_memories` fix —
  the isolation proof reused the one real stored memory/embedding and
  varied only the query's `filter_tenant_id` parameter, which is the
  safest verification method available in a database with exactly one
  real tenant.

### AI provider error-handling fix (2026-08-20, same day) — Settings/validation performance

Root cause of "Settings validation feels slow" traced to `supabase/functions/ai-chat/index.ts`,
not the Settings UI itself: the edge function collapsed every upstream
provider failure — permanent (404 model-not-found, 401 bad key) and
transient (429 rate-limited, 5xx) alike — into a generic HTTP 500. The
client's `isRetryable()` classification in `lib/ai/ai-provider.ts` (already
correct: retries only 429/500/502/503/504) had no way to tell them apart,
so a dead/deprecated model got 3 retries with 1s/2s exponential backoff
just like a genuinely transient error would — wasted per provider, per
fallback attempt. Fixed by making both `handleChat` and `handleStream`
preserve the real upstream HTTP status (a new `UpstreamError` class carries
it through the outer catch), and by restructuring `handleStream` so the
initial connection is checked *before* the streaming `Response` commits to
HTTP 200 — previously a streaming failure was always reported as "200 OK"
with an `{error}` payload buried in the body, which the client could only
ever treat as a hardcoded, unconditional retry. Also added an explicit
30-second upstream fetch timeout (`fetchWithTimeout`, matching the existing
`n8n_timeout`/task-execution timeout convention already used elsewhere in
this codebase, not a new arbitrary value) — previously neither upstream
fetch had any timeout at all. No client-side retry logic needed to change;
it was already correct, just fed the wrong status code. Live-verified: a
provider with a dead model now fails in one request instead of three; a
provider actually rate-limited (429) still correctly retries. Separately,
Settings' `loadSettings()` effect was firing twice on tab-open — confirmed
as React 18 Strict Mode's dev-only double-invoke of an idempotent GET (not
a production issue), given a defensive ignore-flag anyway per React's own
documented pattern. Full detail in the standalone "TEMO AI OS — API
SETTINGS PERFORMANCE FIX REPORT."

---

## DYNAMIC MODEL ROUTER (2026-08-20)

A new `lib/ai/router/` module sits between every real AI call site and
`lib/ai/ai-provider.ts`'s `chatWithFallback`/`streamWithFallback` — it
decides *which* provider+model should handle a request instead of every
call always using whichever single model is configured as the global
`active_provider`. It does not replace the provider adapter registry, the
fallback/retry mechanics, the Usage Ledger, or the budget hard-gate — it
extends all four.

### Why this was needed (confirmed by inspection, not assumed)

Before this pass, `chatWithFallback`/`streamWithFallback` accepted a
`model` option on `ChatOptions` but silently ignored it — `getModelForProvider()`
always overwrote it with whatever `app_settings` had configured for that
provider (`lib/ai/ai-provider.ts`, `getModelForProvider`). `AgentRecord.model`
("Default AI model for this agent") existed on every agent but was only
ever used inside a log-message string in `executionLayer.ts` — never
actually passed to a chat call. Every one of the 11 real AI call sites in
this codebase (mission tasks, chat responses — streaming and non-streaming,
tool-response formatting, manager→worker delegation, manager review, tool
selection, memory summarization/importance/should-remember, intent
classification) used the exact same single globally-configured model
regardless of task type, cost, or which agent was "using" it.

### Architecture

```
Caller (executionLayer.ts, crew-coordinator.ts, manager-delegation.ts,
        planner.ts, summarizer.ts, ai-intent-analyzer.ts)
        │
        ├─ classifyTask()  — deterministic, reuses missionPlanner.ts's
        │                    classifyComplexity/resolveCapabilities/
        │                    estimatePriority rather than duplicating them
        │
        ├─ route()         — lib/ai/router/index.ts
        │     ├─ getCandidateModels()   — reads provider_model_catalog
        │     │                           (server-side persisted real
        │     │                           discovery, see below)
        │     ├─ getAllHealth()         — reads provider_model_health
        │     ├─ checkBudget()          — REUSED from
        │     │                           lib/governance/entitlements.ts,
        │     │                           the same hard-gate
        │     │                           launchMission() already uses
        │     └─ scoreCandidate()       — lib/ai/router/scoring.ts,
        │                                 weighted sum, not an if/else tree
        │
        └─ chatWithFallback(messages, { ..., candidates: decision.candidates })
              — candidates REPLACES the default activeProvider+FALLBACK_ORDER
                walk when supplied; omitting it (any caller not yet
                updated) preserves today's exact behavior unchanged.
                isRetryable() (429/500/502/503/504) is untouched — the
                router only changes candidate ORDER, not retry policy.
```

### Model catalog now persisted server-side (a real gap closed)

The Provider Validation & Model Discovery pass (previous session) already
called each adapter's real `listModels()` — but only ever returned the
result to the browser, which cached it in `localStorage`
(`lib/settings/providerModelCache.ts`). That data was completely
unreachable from any server-side context (mission execution, a Next.js API
route). `supabase/functions/ai-chat/index.ts`'s `action:'validate'` handler
now also persists successful discovery results to a new
`provider_model_catalog` table (upsert, keyed on provider+model_id; an
empty discovery result is treated as "nothing to update," never as "clear
the catalog," so a transient failure can't wipe out a working
configuration). This is the single source of truth `lib/ai/router/modelCatalog.ts`
reads from — no second model registry, no duplicated discovery logic.

### Task classification (deterministic, no LLM call to pick a model)

`lib/ai/router/taskClassifier.ts`'s `classifyTask()` produces one of 13
task types (VOICE, FAST_CHAT, NORMAL_CHAT, AGENT_TO_AGENT, SMALL_TASK,
CODING, RESEARCH, PLANNING, COMPLEX_REASONING, LARGE_MISSION,
TOOL_EXECUTION, VISION, STRUCTURED_OUTPUT) from word count, keyword/capability
matching (reusing `resolveCapabilities`), and caller-supplied flags
(`isVoice`, `isAgentToAgent`, `needsTools`, `needsStructuredOutput`,
`hasVisionInput`). `isVoice` is threaded from `voice-manager.ts` through
`orchestrate()` exactly the way `isSimulation` already was in an earlier
pass (`OrchestrateOptions.isVoice` → `runSimplePipeline` →
`crewCoordinator.routeAndRespond()`).

### Model capability profile — real data only, "unknown" is a real value

`ModelCapabilityProfile` (`lib/ai/router/types.ts`) carries provider-reported
fields (free/pricing/context-length/streaming/tools — from the real catalog,
`null`/`'unknown'` when the provider's own API doesn't expose them, never
guessed) structurally separate from a small set of *inferred* fields
(`inferredReasoningStrength`/`inferredCodingStrength`/`inferredSpeedTier`,
`lib/ai/router/modelCapabilities.ts`) derived from real, common naming
conventions ("flash"/"instant"/"8b" → fast; "pro"/"70b"+/"opus" → stronger
reasoning) — never presented as a provider-confirmed fact. Vision/audio/
structured-output/multilingual capability fields stay `'unknown'` for every
current provider, honestly, since none of the discovery endpoints this app
calls report them and this app has no real audio/vision-model integration
today (see Voice, below).

### Scoring (configurable weighted sum — `lib/ai/router/scoring.ts`)

`capabilityMatch + taskMatch + reliability + latency + contextFit +
providerHealth + validationRecency + structuredToolFit − costPenalty −
rateLimitPenalty − failurePenalty`, each term normalized to roughly [0,1]
before its weight is applied. Five strategy presets (`balanced` default,
`speed`, `quality`, `cost`, `free_only`) multiply specific weights rather
than replacing the formula — `free_only` also hard-filters to
provider-confirmed `free === true` candidates before scoring, not merely a
weight nudge. Weights are one exported `const` object, not scattered
magic numbers.

### Provider/model health (a real, narrow gap closed)

`usage_ledger` only ever recorded successful calls, by explicit original
design (its own migration header) — zero failure/latency signal existed
anywhere before this pass. A new `provider_model_health` table (one row
per provider+model, incrementally updated via the `record_provider_model_health()`
Postgres function — atomic upsert, not a full event log, per the mission's
explicit "do not build an unnecessarily complicated observability
platform" instruction) now tracks success/failure counts, consecutive
failures, a running-average latency, and the last status code.
`chatWithFallback`/`streamWithFallback` call `recordHealth()` after every
single provider attempt (success or failure) — fire-and-forget, matching
the existing non-blocking `recordUsage()` pattern. `usage_ledger` itself
also gained one additive `latency_ms` column, since successful-call latency
is genuinely usage-adjacent data.

**Live bug found and fixed during verification**: `record_provider_model_health()`
initially had only a SELECT RLS policy — a direct RPC probe confirmed
`"new row violates row-level security policy"` when called from a
browser/`authenticated` context (which is where `crew-coordinator.ts`
actually runs). Fixed by making the function `SECURITY DEFINER`
(`20260820130000_fix_provider_model_health_rls.sql`) — narrower and safer
than opening the underlying table to broad authenticated writes, since the
function only ever increments counters for a given provider/model pair.

### Cost/budget integration

Real, provider-reported pricing from `provider_model_catalog` (e.g.
OpenRouter's actual per-model `$/token` figures) is preferred over the
static `lib/ai/pricing.ts` table, which remains the fallback for providers/
models the catalog hasn't priced. A candidate whose estimated cost would
exceed the tenant's *remaining* budget headroom (`checkBudget()`'s
`limitUsd - spendUsd`, the same function `launchMission()` already
hard-gates on) is removed outright, not merely deprioritized. No pricing is
ever invented — an unpriced model gets a mild cost-uncertainty penalty in
scoring, not a fabricated number.

### Fallback safety

`route()` never throws — any internal failure degrades to an empty
candidate list, which `chatWithFallback`/`streamWithFallback` already treat
identically to "no router candidates supplied" (today's original
behavior). If every candidate gets filtered out (e.g. a strict `free_only`
strategy with no free models configured), the router falls back to the
full unfiltered scored list rather than returning zero candidates — an
imperfect answer beats silently blocking execution.

### Mission-level routing

`executionLayer.ts`'s `executeTask()` classifies and routes independently
per task (using that task's own title/description/`requiredCapability`,
not the whole mission's), so a single mission genuinely can — and, live-verified,
does — use different providers/models for different tasks. The
`provider_selected` mission-timeline event now shows the real routing
decision and its `reason`, replacing what was previously always
`settings.active_provider` regardless of which provider actually executed.

### Agent-to-agent routing

`manager-delegation.ts`'s `executeWorker()`/`managerReview()` (manager→worker
task delegation and the manager's review-and-synthesize step) both classify
with `isAgentToAgent: true`, which biases the scorer toward latency and
reliability over raw capability — internal coordination doesn't
automatically reach for the strongest (slowest, priciest) configured model.

### Voice routing

Voice transcription and synthesis remain entirely client-side (Web Speech
API — confirmed unchanged, `lib/voice/voice-recorder.ts`/`voice-player.ts`).
The router's VOICE task type only ever applies to the LLM call that
processes the *transcribed text* (via `orchestrate()` → the same pipeline
text chat uses) — it biases toward low latency and fast-tier models. No
model in the current provider pool is claimed to have genuine audio/vision
capability; those `ModelCapabilityProfile` fields stay `'unknown'`
everywhere, honestly, rather than fabricated to make "voice routing" sound
more capable than the app's real STT/TTS architecture is.

### OpenRouter as a dynamic pool

OpenRouter's real catalog (hundreds of models, live-verified) is not
exposed as-is — `route()`'s scoring/filtering (capability match, cost,
context fit, budget, `free_only`) narrows it exactly the same way it
narrows every other provider's candidate list. OpenRouter simply tends to
win more often for `free_only`/cost-sensitive routing because it's the
richest source of real, provider-confirmed `$0` pricing.

### Ollama

Unchanged local-vs-cloud handling: local (`localhost`/`127.0.0.1`) gets
`free: true` as a structural fact (self-hosted, zero marginal API cost,
not a guess), and a cloud-hosted Ollama endpoint is treated like any other
remote provider for cost purposes. The router does not attempt to route a
server-side request to a `localhost` URL the server itself can't reach — a
known, already-documented limitation of this app's edge-function
architecture generally (Supabase's cloud runtime has its own loopback, not
the admin's machine), not something this pass changed or could fix.

### Settings UI

Added, not a redesign: an "AI Routing" block (Automatic/Manual mode toggle,
Balanced/Speed/Quality/Cost/Free Only strategy selector) in the existing
Settings → AI Providers card, immediately below "Active Provider." Backed
by three new additive `app_settings` columns (`routing_mode`,
`routing_strategy`, `routing_preferences` jsonb). The advanced per-task-type
manual override editor (voice/fast-chat/reasoning/coding/agent-to-agent
pickers) described as "optional" in the brief was not built as a UI in this
pass — `routing_preferences` and the router's consumption of it are fully
implemented and functional, just not yet exposed through an editor.

### Real E2E verification performed (not typecheck-only)

Live, not inferred: a real chat message was classified `FAST_CHAT` and
routed to `openrouter/cohere/north-mini-code:free` — genuinely different
from the globally-configured Gemini model, because Gemini was actually
rate-limited (429) from the day's extensive testing; `provider_model_health`
correctly recorded that real failure (`consecutive_failures: 1`) alongside
Groq's real success (949ms latency). A real multi-task mission ("Research
competitor pricing strategies and create a go-to-market plan") produced 7
real tasks; the first, classified `LARGE_MISSION`, routed to
`openrouter/meta-llama/llama-3.3-70b-instruct` with the decision correctly
recorded in both `usage_ledger.metadata` and the mission timeline. The
Settings UI's Free Only strategy was selected and saved live, then
confirmed to route to a real, provider-confirmed-free model on the next
request. Full trace in the standalone "TEMO AI OS — DYNAMIC MODEL ROUTER
IMPLEMENTATION REPORT."

### Known limitations (honestly stated)

- Per-task-type manual override UI not built (see Settings UI above) —
  the underlying mechanism works, there's no editor for it yet.
- `inferredReasoningStrength`/`inferredCodingStrength`/`inferredSpeedTier`
  are name-pattern heuristics, not provider-confirmed facts — kept
  structurally separate from real catalog data specifically so this
  distinction can never be lost downstream.
- Vision/audio routing has no real target to route to — this app has no
  audio-native or vision-native provider integration, so `VISION`
  classification exists in the type system but has never been exercised
  against a real capability.
- A learning loop beyond "recent success/failure counts feed future
  scoring" (e.g. actively re-weighting scoring dimensions from outcomes
  over time) was explicitly out of scope for this pass, per the mission's
  own "V1 should remain deterministic and explainable... rules + scoring +
  telemetry, not opaque autonomous ML routing" instruction.

---

## CLAUDE CODE DEVELOPMENT ORGANIZATION

This section documents the Claude Code development workspace prepared for long-running autonomous development on Temo AI OS. It is workspace/tooling configuration, not application architecture — nothing in this section changes runtime behavior. Permanent development rules live in [CLAUDE.md](../CLAUDE.md) at the repo root; this section documents *what was built* to support those rules.

### Verified project state at time of preparation

- **Not a git repository.** `git status` fails with "not a git repository" — there is currently no version-control safety net for this codebase. This is the single biggest development-safety gap found (see Safety Rules below).
- No `CLAUDE.md` existed prior to this task; one now does (repo root).
- `.claude/` existed with only a `scheduled_tasks.lock` file — a clean slate for agents/skills/hooks.
- A pre-existing document, `TEMO_TECHNICAL_PROJECT_SUMMARY.md` (repo root), contains the original master specification and roadmap. It predates the Sprint 1–3 work in this document and is **partially stale** on implementation status (e.g. it says worker agents are "not yet implemented" — they exist for Nova as of the original audit) and reflects a different next-step roadmap (cinematic v0 dashboard → auth → worker agents) than the one actually pursued (registry unification → delegation generalization → usage/cost governance). Both documents are kept; this one is authoritative for current implementation state, but the roadmap divergence is a real, undecided question — see the `temo-product` agent below.

### Development Agents (`.claude/agents/`)

Six subagents, deliberately kept small — "a small, efficient engineering organization," not maximum coverage:

| Agent | Responsibility | Model | Mode |
|---|---|---|---|
| `temo-architecture` | Guards against duplicate orchestration paths; keeps this document in sync after sprints | opus | Implementation-capable, conservative |
| `temo-orchestration` | Agent registry, crew routing, mission engine, delegation, AI provider/usage-ledger layer | sonnet | Implementation-capable |
| `temo-data` | Supabase migrations/RLS, memory/knowledge persistence, tools/n8n integration, API routes | sonnet | Implementation-capable |
| `temo-qa` | Typecheck/lint/regression/duplicate-abstraction verification after implementation stages | sonnet | Read-only/verification |
| `temo-security` | Auth, RLS, secrets, tenant-isolation groundwork, approval gates | opus | Advisory/read-only today; implementation-capable once auth work is explicitly scoped |
| `temo-product` | Sanity-checks features against the stated business vision; surfaces the roadmap conflict noted above | sonnet | Read-only/advisory |

**Intentionally not created:** a separate Backend or Frontend agent (their scope is fully covered by `temo-orchestration`/`temo-data`, and the UI layer hasn't needed dedicated specialist attention); a separate R&D/Innovation agent (no R&D sandbox subsystem exists yet — its eventual responsibilities are covered by `temo-architecture` and `temo-orchestration` until there's enough distinct R&D work, e.g. real model-evaluation sprints, to justify one).

### Skills (`.claude/skills/`)

Four project-specific skills, chosen because they encode a procedure this project has already proven valuable — not a speculative one:

- **`sprint-close`** — the exact verify-then-document-then-report protocol used successfully across Sprints 1, 1.5, 2, and 3 (typecheck → lint → regression grep → duplicate-abstraction check → update this document → structured report). Encodes a proven, repeated workflow.
- **`architecture-governance`** — the "search first, extend before creating, prefer registry-driven over hardcoded" checklist that prevented Sprint 2 from re-creating the `lib/crew` vs `lib/agents` duplication mistake.
- **`db-migration-review`** — this project's specific migration conventions (additive-only, RLS pattern selection by table semantics, ID-type matching, enum-vs-text judgment) empirically established across the Sprint 1 and Sprint 3 migrations.
- **`temo-security-review`** — a Temo-specific supplement (not a replacement) to the general-purpose `security-review` skill already available in this environment; covers this project's particular patterns (edge-function-only key access, single-tenant RLS posture, tenant-isolation readiness).

**Intentionally not created:** a generic "Testing & Verification" skill (folded into `sprint-close` — there's no test framework yet, so a dedicated skill would be thin); a "Business/Product Validation" skill (business judgment calls benefit more from the `temo-product` agent's discussion than a fixed checklist); a "Research & Innovation" skill (no R&D subsystem exists yet to write a procedure for).

### Hooks (`.claude/settings.json`)

Two lightweight, deterministic `PreToolUse` hooks — chosen specifically to avoid the "excessive repeated execution" trap (no hook fires on every edit or every turn; both are narrow pattern-matches on specific tool calls):

1. **Destructive-command guard** (matcher: `Bash`) — pattern-matches the command against `rm -rf`, `git push --force`/`-f`, `git reset --hard`, `DROP TABLE`/`DROP DATABASE`, `TRUNCATE`, `git clean -f` (case-insensitive). On match, returns a `permissionDecision: "ask"` so a human confirms before it runs, rather than a hard block (a false positive here should cost one confirmation, not a blocked legitimate operation). Implemented as a single-line Node.js script (no `jq` dependency — verified absent from this environment's PATH) reading the tool-call JSON from stdin.
2. **Secret/.env guard** (matcher: `Write|Edit`) — pattern-matches the target file's basename against `.env`/`.env.*`, and the content being written against key-shaped patterns (`sk-...`, `AIza...`, a JWT shape `eyJ...`). On match, asks for confirmation rather than blocking. Handles both `/`- and `\`-style path separators (verified against a Windows-style path).

Both hooks were pipe-tested against synthetic tool-call payloads (trigger and non-trigger cases) before being written into `settings.json`, and the exact strings extracted back out of the written file were re-tested to confirm the JSON escaping round-trips correctly.

**Intentionally not created:** an auto-typecheck-on-every-edit hook (this project's full `tsc --noEmit` run takes real time; running it after every single edit would be exactly the "excessive repeated execution" the task warned against — `sprint-close` covers this at natural completion points instead); a docs-reminder Stop hook (redundant with `sprint-close`, and would fire noisily on trivial turns).

### MCP / Connectors — recommendation, not installation

No MCP connector was installed. For each candidate considered:

| Candidate | Verdict | Reasoning |
|---|---|---|
| GitHub | Not required now | The repository isn't a git repository yet — a GitHub connector is premature until version control exists and a remote is chosen. Revisit after that. |
| Supabase (live DB introspection) | Not required now, worth it later | This project's migrations are file-based (`supabase/migrations/*.sql`), and every sprint so far only needed to *read* those files to reason about schema — already fully covered by the built-in Read/Grep tools. A live connector would add value for verifying a migration actually applies cleanly or inspecting live data (e.g. sanity-checking `usage_ledger` rows), but that's a "when we want it" capability, not a blocking gap, and should be credential-scoped deliberately (ideally read-only/staging) rather than added reflexively. |
| Browser/Chrome (for UI verification) | Already available, not a new install | This environment already exposes a `chrome` config toggle and a `run` skill ("launch and drive this project's app to see a change working") — both cover this need without a separate MCP connector. Worth flagging honestly: **none of Sprints 1–3 in this project actually used either** — verification was typecheck/lint/grep only, never a real click-through of the chat UI. That's a real, existing gap, but the fix is "use what's already available," not "install something new." |
| Documentation/research tools | Already available, not a new install | `WebFetch`/`WebSearch` are already available in this environment. |
| Filesystem | Already available, not a new install | Read/Write/Edit/Glob/Grep/Bash already fully cover this. |

**Net result: no new MCP connector is currently justified.** The strongest latent candidate (Supabase) is explicitly deferred pending an actual need and deliberate credential scoping, not configured speculatively.

### Model-Selection Strategy

Per CLAUDE.md: cost-efficient models for simple/mechanical work, stronger reasoning for architecture/security/large refactors. Applied concretely: `temo-architecture` and `temo-security` (the two agents whose mistakes are hardest to undo — a bad structural decision or a security regression) default to **opus**; `temo-orchestration`, `temo-data`, and `temo-product` default to **sonnet**; `temo-qa` defaults to **sonnet** (mechanical checks, but correctly diagnosing *why* a typecheck/lint failure happened benefits from more than the cheapest tier). None default to haiku today — nothing in this workspace's current task set is purely mechanical enough to warrant it, but that's a call any agent invocation can override per-task.

### Development Workflow

1. Read [CLAUDE.md](../CLAUDE.md) and this document before starting.
2. For structural questions, consult (or think like) `temo-architecture` first — search before creating.
3. Implement via `temo-orchestration`/`temo-data` as appropriate to the subsystem.
4. Verify via `temo-qa`'s protocol (equivalently, the `sprint-close` skill) before calling anything done.
5. For anything security- or auth-adjacent, consult `temo-security` before implementing, not after.
6. For anything of unclear business priority, consult `temo-product` rather than assuming.
7. Update this document (version bump, dated section, status table) as the final step of any completed stage — not as an afterthought.

### Safety Rules (Section 7 findings)

- **No git repository exists.** This is the top development-safety risk in the project today — there is no commit history, no diff review, no revert path for any change. This was *not* fixed as part of this workspace-preparation task (initializing version control is a real project decision the owner should make deliberately, not something to do silently as a side effect of "prepare the workspace"), but it is the single strongest recommendation coming out of this task.
- **No `.env`/secret leakage path found.** `.gitignore` already excludes `.env*`; provider keys live server-side in Supabase (`app_settings`, read only by Edge Functions with the service-role key) — confirmed consistent with the Sprint 3 audit. The new secret/.env hook adds a second layer of protection against accidentally writing a live secret into a tracked file.
- **Destructive-command protection** now exists via the Bash hook (above) — previously nothing stood between an accidental `rm -rf`/force-push/`DROP TABLE` and execution.
- **Duplicate-architecture protection** is now encoded in both `CLAUDE.md` (rule: "do not create duplicate registries, routers, orchestration engines, or providers") and the `architecture-governance` skill — directly addressing the one architectural mistake this project has actually made (the `lib/crew`/`lib/agents` duplication unwound in Sprints 1–1.5).
- **Uncontrolled dependency growth**: no tooling was added for this (no automated dependency-audit hook), but it's now a named principle in CLAUDE.md ("search before creating new abstractions") extending naturally to "check whether an existing dependency already covers this before adding a new package."
- **Bypassing tests**: not currently enforceable by tooling since no test framework exists — flagged explicitly in `CLAUDE.md` and `sprint-close` so its absence is never silently assumed away once a framework exists.

---

## M1-01 — TOOL EXECUTOR WIRED INTO MISSION ENGINE (2026-08-25)

**Ticket**: `docs/BACKLOG-M1.md` M1-01, first ticket of Milestone 1 (Reliability & Safety), opened by the Claude Cowork governance review. Branch: `milestone-1-reliability`.

**Problem**: `lib/swarm/executionLayer.ts`'s `executeTask()` only ever called the LLM directly. It never invoked `lib/tools/executor.ts`. Missions (multi-step, delegated work) could not use any tool, including n8n — only the synchronous chat path could, via `decideTools()`.

**What changed**:
- `executeTask()` now runs the same `detectIntent()` → `decideTools()` gate the chat path already uses (`lib/context/tool-decision.ts`), reused rather than duplicated. If the task's title/description reads as a tool action, the real tool executor runs — `requiresApproval` and `isSimulation` are respected automatically, since both callers now share the exact same `toolExecutor.execute()` choke point.
  - Tool fully answers the task → the LLM/worker call is skipped entirely (mirrors the chat path's `shouldCallLLM: false` shortcut).
  - Tool call fails → the error is thrown into `executeTask()`'s existing retry/backoff loop, so a failed tool call is a failed task after retries are exhausted — not silently swallowed, and not papered over with an LLM fallback response (deliberately different from the chat path's graceful degradation, since a mission task is the concrete unit of work, not a conversational turn).
  - No tool action detected → unchanged: existing LLM/worker execution path.
  - New timeline events: `tool_selected` (before invocation) and `workflow_executed` (result, success or failure) — both pre-existing `mission_timeline_event` enum values added in an earlier migration for exactly this purpose, never wired up until now. No new migration needed.
  - `decideTools()` gained two new optional trailing params, `missionId`/`taskId` (default `undefined`, so the chat path's call site is unaffected), threaded into the `ToolRequest` so approval requests created from a mission-originated tool call are correctly linked back to the mission/task that triggered them.
- **A second, more consequential bug found and fixed while live-verifying the above**: `toolRegistry` (`lib/tools/registry.ts`) is an in-memory singleton scoped to whichever JS process holds it. Registration (`registerBuiltinTools()`) was only ever called from `initToolEngine()`, itself only ever called from `components/providers.tsx`'s client-side mount effect. The synchronous chat/voice mission path runs client-side (`orchestrate()` is called directly from `app/chat/page.tsx`), so it happened to work — but the background task-queue processor (`app/api/tasks/process/route.ts`) runs server-side, in a separate process that never populated the registry. A server-executed task's tool decision would have silently seen an empty registry and always fallen through to the LLM — no error, no signal, just a tool call that quietly never happened. Fixed by adding `ensureBuiltinToolsRegistered()` (`lib/tools/builtin-tools.ts`), an idempotent guard now called defensively from both `decideTools()` and `toolExecutor.execute()` itself, so registration happens correctly regardless of which process/caller reaches it first. `initToolEngine()` now calls the same guard instead of `registerBuiltinTools()` directly.

**Live verification performed** (not typecheck-only): typecheck and lint clean. A throwaway `tsx` script (deleted after use) created a real mission + real tasks via the service-role client and called `executeTask()` directly against the running codebase:
- **Success path** (`memory.timeline`, a real DB-backed tool, not a placeholder): task completed with steps `["Tool Decision", "Tool Execution"]` — the LLM was never invoked. `mission_timeline` shows real `tool_selected`/`workflow_executed` events.
- **Failure path** (`n8n.triggerWorkflowByName`, with local n8n intentionally not running in this dev environment): the tool genuinely failed (`"The n8n integration service returned an invalid response."`), retried once per `maxRetries`, then the task ended in `status: 'failed'` with the real error message persisted to `error_message` — confirmed via direct DB read, not inferred.
- **`requiresApproval` gate**: called `toolExecutor.execute()` directly for `memory.forget` (a `requiresApproval: true` tool) with `missionId`/`taskId` set — got `ok: false`, `pendingApprovalId` set, and confirmed a real row in `approval_requests` correctly linked to the test mission and task.
- `isSimulation` was not separately live-tested this pass — it follows the exact same parameter-threading path as `tenantId`/`missionId`, which was live-confirmed via the approval test, and the branch itself (`executor.ts`) is unconditional/caller-agnostic; noted as CODE VERIFIED rather than re-proven redundantly.
- All test missions/tasks/timeline rows/approval requests were deleted via service-role cleanup after verification; nothing test-related was left in the database.

**Also noted, not fixed this pass (pre-existing, unrelated to M1-01's own scope)**: `requestApproval()` (`lib/governance/approvals.ts`) has no deduplication — a tool call that hits the approval gate on every retry attempt would create one `approval_requests` row per attempt. This already existed for the chat path; M1-01's retry loop makes it slightly more likely to surface (up to `maxRetries + 1` rows for one blocked mission task) but did not introduce it. Worth a small follow-up ticket if it proves noisy in practice.

### Addendum — real n8n success path confirmed, 3 real bugs found and fixed (2026-08-26)

Local n8n (Docker) + `cloudflared` tunnel became available after the above was written. Re-ran the n8n success-path test for real and hit three genuine, previously-undiscovered bugs in `supabase/functions/n8n-proxy` — none of this code had ever round-tripped through a live n8n instance before, since n8n only just started running in this dev environment:

1. **`createWorkflow` missing `settings`**: n8n's create-workflow endpoint requires a `settings` object in the request body even when empty; `workflowService.ts`'s `createWorkflow()` never sent one. Fixed by defaulting `{ settings: {}, ...workflow }`.
2. **Wrong response-unwrapping on every single-resource endpoint**: `getWorkflow`, `createWorkflow`, `updateWorkflow`, `activateWorkflow`, `deactivateWorkflow` (`workflowService.ts`) and `getExecution` (`executionService.ts`) all assumed n8n wraps responses in `{ data: ... }` — true for n8n's *list* endpoints, but single-resource GET/POST/PATCH responses are flat objects. Confirmed both shapes live via direct `curl` against the running n8n instance before fixing. Every one of these functions was silently returning `undefined` (or reading `undefined.data`, crashing) on a real n8n instance until now.
3. **`convertToWebhook` never activated the workflow it created**: n8n only registers a webhook's listener route for an *active* workflow, so the webhook URL the tool returned 404'd until manually activated. Fixed by calling `activateWorkflow()` on the new workflow before returning — the natural completion of "convert to webhook," not a separate step the caller should need to know about.

**Live re-verification after the fixes**: created a real webhook-triggered duplicate of the safe "Simple System Test Workflow (No APIs)" (manual-trigger, no external API calls) via `n8n.convertToWebhook`, confirmed it was auto-activated, then triggered it via `n8n.triggerWorkflowByName` through `toolExecutor.execute()` — the exact function `executeTask()` calls. Result: `ok: true`, `httpStatus: 200`, `payload: {"message":"Workflow was started"}`. Cross-checked directly against n8n's own execution history (`GET /executions?workflowId=...`) before and after: zero executions before, one real execution after — `status: "success"`, `finished: true`, `mode: "webhook"`, completed in ~488ms. This closes the one item M1-01's original acceptance criteria left unverified. Test workflow deleted from n8n afterward; no test artifacts left behind.

**Separately noted, not fixed (genuine AI non-determinism, not a code defect)**: `lib/tools/planner.ts`'s `toolPlanner.plan()` (the LLM-driven step that picks a tool + fills in its arguments from natural language) twice failed to populate a required parameter (`id`, then `name`) for an n8n trigger call during this re-test, even with the workflow name spelled out explicitly in the task description — this affected both the automatic mission-task path and would equally affect the chat path, since both share the same planner. The final verification above bypassed the planner and called `toolExecutor.execute()` with explicit correct arguments to isolate and prove the executor-wiring path specifically (M1-01's actual scope) independent of planner argument-extraction reliability. The planner's prompt/reliability is a real, separate concern worth its own ticket if it proves consistently unreliable — not chased further here to keep this addendum scoped to what M1-01 owns.

## M1-02 — BUDGET HARD-GATE BEFORE SPEND (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-02. Branch: `milestone-1-reliability`.

**Problem**: `checkBudget()` existed and was queryable, but nothing called it before an actual AI provider spend. `lib/swarm/missionEngine.ts`'s `launchMission()` already had its own hard gate at mission-creation time (pre-existing, unrelated to this ticket), and `lib/ai/router/index.ts`'s `route()` did soft budget-aware filtering — but both only apply to callers that go through those specific paths. Every other `chatWithFallback`/`streamWithFallback` caller (plain chat, tool planning, memory summarization, intent classification) had no budget check at all.

**What changed**:
- New `applyBudgetGate()` in `lib/ai/ai-provider.ts`, called at the top of both `chatWithFallback()` and `streamWithFallback()` — the single choke point every real AI call passes through. Given `options.usageContext?.tenantId`:
  - No `tenantId` → not gated (matches `checkBudget()`'s own "no tenant to check" posture; covers internal system calls — tool planning, memory summarization, intent classification — that don't currently carry tenant attribution, a pre-existing gap unrelated to this ticket).
  - Tenant within budget → unaffected, proceeds normally.
  - Tenant over budget → Ollama candidates (self-hosted, zero marginal cost per `lib/ai/pricing.ts`) are kept, every paid candidate is stripped from the fallback chain. If Ollama isn't among the candidates, the call throws a clear `Monthly AI budget exceeded ($X / $Y)...` error before any provider is ever called — no silent failure, no generic error.
- New migration `20260826120000_seed_internal_tenant_budget.sql`: the `budgets` table was completely empty for every tenant (including internal), so `checkBudget()`'s "no row = unlimited" default meant the internal tenant was unlimited by default despite the ticket's explicit requirement otherwise. Seeded a $50/month placeholder ceiling for the internal tenant (`00000000-0000-0000-0000-000000000001`) — **this dollar figure is a placeholder to prove the mechanism has a non-null default, not a considered financial decision; Amro should review/adjust it directly in the `budgets` table.** No Settings UI for editing budgets exists yet — out of this ticket's explicit acceptance criteria, flagged as a real gap for a future ticket.
- Also applied while here: the previously-written-but-never-applied `20260822100000_fix_stale_running_task_recovery.sql` migration (from the prior session, see the P0 RLS/task-queue audit further up this document) was found still pending via `supabase migration list` and applied via `supabase db push` — a genuine `supabase` CLI DB link was discovered working this session (`supabase functions deploy`/`db push` both authenticate successfully), superseding the earlier assumption that migrations required manual SQL-editor application.

**Live verification performed** (not typecheck-only): typecheck clean, lint clean. A throwaway script created a real tenant, gave it a $0.01 budget with a seeded $1.00 usage_ledger row (genuinely over budget), then called the real `chatWithFallback()`:
- **Hard block**: candidates `[gemini]` only → threw `"Monthly AI budget exceeded ($1.00 / $0.01). Raise the budget in Settings or wait for the next billing period."` — no provider was called.
- **Ollama exemption**: candidates `[gemini, ollama]` → the budget gate let it through (attempted ollama for real; failed only because no local Ollama server is running in this environment — `ECONNREFUSED`, a network error, not the budget error), proving the gate itself did not block when a zero-cost candidate was available.
- **No-tenant regression check**: a call with no `tenantId` in `usageContext` proceeded normally, confirming internal/system calls that predate tenant attribution are unaffected.
- Test tenant, its budget row, and its usage_ledger row were deleted afterward; nothing test-related left in the database.

## M1-03 — RATE LIMITING ON PUBLIC API ROUTES (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-03. Branch: `milestone-1-reliability`.

**Scoping finding, not an assumption**: the ticket's acceptance criteria targets "every route under `app/api/**` that can trigger an AI call or a tool execution." Grepped all 23 routes for `chatWithFallback`/`streamWithFallback`/`toolExecutor`/`executeTask`/`executeMissionTasks`/`launchMission`/`orchestrate(` — exactly **2 routes** match: `app/api/tasks/process` (the background queue processor — real AI calls + real tool execution via `executeTask()`) and `app/api/settings/validate-provider` (proxies a real provider validation ping through the `ai-chat` edge function). This matches an earlier architectural finding from this same document: the primary chat/mission execution path (`orchestrate()`) runs **client-side** (`app/chat/page.tsx`), not through an API route — so most of the surface a naive reading of "public API routes" suggests doesn't actually apply here. Every other route is read-only or plain CRUD (agents, missions metadata, runtime state, stats, streams, task queue status) with no AI/tool trigger.

**What changed**:
- New migration `20260826130000_create_rate_limit_buckets.sql`: `rate_limit_buckets` table + `check_rate_limit()` Postgres function — atomic token-bucket check-and-consume in a single `plpgsql` call (`FOR UPDATE` row lock per key), same pattern as `claim_ready_tasks()`'s existing atomic-RPC style rather than an app-side read-then-write that would race under concurrent callers. RLS enabled with zero policies (service-role only, same posture as other server-internal tables).
- New `lib/api/rateLimit.ts`: `checkRateLimit(key, opts)` wrapper (fails **open** — allows the request — on any infrastructure error, since a broken rate limiter must never become an outage; the routes' own auth/budget gates are the real safety backstop) and `getClientIp()` (standard proxy header extraction).
- New `rateLimited()` helper in `lib/api/response.ts`, matching the existing `ok()`/`fail()` envelope convention — returns a `429` with `error.code: 'RATE_LIMITED'` and a clear `Try again in Ns.` message.
- `app/api/settings/validate-provider`: rate-limited **per authenticated user** (10 tokens, refill 10/min) and **per IP** (20 tokens, refill 20/min) — this route is `requireUser()`-gated already, so a per-user key is available and more precise than IP alone.
- `app/api/tasks/process`: rate-limited **per IP only** (12 tokens, refill 1/5s) — this route is secret-authenticated (a cron caller, not a per-user session), and one invocation can process tasks across many tenants, so there's no single "calling tenant" to key on; IP is the only meaningful bucket here. Sized for a legitimate scheduler polling every few seconds, not for hammering.

**Live verification performed** (not typecheck-only): typecheck and lint clean.
- Direct `check_rate_limit()` test via `checkRateLimit()`: a 3-token bucket allowed exactly 3 calls, the 4th was blocked with a real `resetSeconds` countdown, and `remaining` correctly ticked up slightly between calls from real elapsed-time refill — confirmed via the actual Postgres function, not a mock.
- Real HTTP test against the live `settings/validate-provider` route (dev server, real authenticated session): 11 calls succeeded, the 12th returned a real `429` with `{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again in 5s."}}` — the exact `lib/api/response.ts` envelope shape the ticket requires.
- Test-only bucket rows deleted afterward; the two buckets created by the real HTTP test against the dev-tester account were left in place (legitimate state, not test junk — they refill naturally).

## M1-04 — REAL N8N EXECUTION VERIFICATION (NO MORE FAKE SUCCESS) (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-04. Branch: `milestone-1-reliability`.

**Problem**: `lib/crew/n8n-action-handler.ts`'s `handleRun()` reported `success` based solely on the webhook trigger's HTTP status. n8n's `onReceived` webhook response mode replies to the caller the instant the webhook is *received*, before the workflow has actually run — so a `success: true` never meant the workflow genuinely finished, only that the HTTP request landed.

**What changed**:
- `handleRun()` now polls real execution history after a successful trigger — `waitForExecutionResult()` calls `n8n.executions.listExecutions(5, undefined, workflowId)` every 1.5s (bounded to a 20s timeout), looking for an execution that started at-or-after the trigger time and has reached a terminal state (`finished` or `status: 'error'`).
  - Real success (`status !== 'error'`) → `success: true` with the real execution ID in the summary.
  - Real failure (`status === 'error'`) → `success: false`, summary includes the actual n8n error message.
  - Timeout (no terminal execution found in time) → `success: false`, `"I triggered [...] but couldn't confirm it finished within 20s — check n8n directly."` — never a false "Done."
- Extended `listExecutions()` (client `services/n8n/executionService.ts`, edge function `supabase/functions/n8n-proxy/executionService.ts` + `index.ts` dispatcher) with an optional `workflowId` filter — needed to correlate a webhook trigger (which returns no execution ID) back to the execution it produced; n8n's real `GET /executions?workflowId=X` supports this natively.
- **Two more real, previously-hidden bugs found while live-verifying, both fixed**:
  1. `parseN8nAction()`'s workflow-name extraction regex: for input like `run workflow "Simple System Test Workflow (No APIs) (Webhook)"`, the lazy fallback regex matched the leading verb itself ("run") the instant it hit the literal word "workflow" that follows — never reaching the actual quoted name. This silently broke the natural-language `run/trigger workflow "<name>"` pattern for any quoted name, which is Flow's primary interaction shape for this whole feature. Fixed by checking for an explicit quoted string first (unambiguous), only falling back to the fuzzy heuristic for unquoted input.
  2. `N8nExecution.executionId` was the wrong field name — n8n's real API returns `id`, not `executionId` (confirmed live via direct API response inspection). This type had never round-tripped through a live n8n instance before. Fixed in both the client and edge-function type definitions, plus two now-corrected call sites: `n8n-action-handler.ts`'s new summary text, and `app/workflows/page.tsx`'s execution-history list — which had been silently rendering `Execution #undefined` for every row.

**Live verification performed** (not typecheck-only): typecheck and lint clean; edge function redeployed.
- Created a fresh, safe, real webhook-triggered workflow (the same no-op test workflow used in M1-01), triggered it via `executeN8nAction('run workflow "..."')` — the real natural-language entry point, not a bypassed direct call. Result: `success: true`, `"Workflow [...] completed successfully (execution 11)."`, with the real execution object attached (`status: "success"`, `finished: true`) — cross-checked against n8n's own execution history, not inferred from the trigger's HTTP status.
- Ran against a nonexistent workflow name: real, honest failure — `"Workflow \"...\" not found."` — never a false success.
- Along the way, discovered and cleaned up several orphaned duplicate test workflows left over from earlier M1-01 verification (same name, causing `triggerByName` to occasionally match a stale inactive duplicate instead of the intended active one) — a reminder that this multi-duplicate-by-name lookup pattern (`triggerByName` matches on name, not a stable reference) is itself a latent footgun worth noting for a future ticket, not fixed here since it's outside M1-04's scope.
- Test workflow deleted afterward; nothing test-related left in n8n or the database.

## M1-05 — CHAT CONVERSATION PERSISTENCE (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-05. Branch: `milestone-1-reliability`.

**Problem**: `app/chat/page.tsx` had no `conversationId` lifecycle at all — no `localStorage`, no DB load-on-mount. A refresh silently lost the conversation. This was purely a client-side gap: `lib/crew/crew-coordinator.ts`'s `persistMessage()` (called from 5 sites covering every user message and every assistant response on the simple/non-mission path) was already writing real rows to `conversations`/`messages` — the write side worked; nothing ever read it back or remembered the active conversation across a page lifecycle.

**What changed**:
- New mount effect in `app/chat/page.tsx`: once agents are loaded and a tenant is known, looks for a remembered conversation id in `localStorage` (key scoped per-tenant: `temo:activeConversationId:<tenantId>`, so switching tenants on a shared browser doesn't resume the wrong one). If none is stored (fresh browser/device), falls back to `ConversationService.getConversations(1)` — the tenant's most recently updated conversation, scoped automatically by the existing `conversations_tenant_select` RLS policy, no explicit tenant filter needed in the query itself. If a conversation is found, its real messages are loaded via `ConversationService.getMessages()`, mapped into the page's local `Message` shape (resolving each message's `agentName`/`color`/`icon` from the already-loaded `agents` list), and `crewCoordinator.setConversationId()` is called so the *next* message the user sends continues the same conversation rather than starting a new one.
- `send()`'s existing (but previously fire-and-forget) `crewCoordinator.startConversation()` call now captures the returned id and writes it to `localStorage` immediately — so even the very first message of a brand-new conversation survives an instant refresh, not just conversations resumed on a later visit.
- No new persistence layer — `ConversationService` (already DB-backed) is reused exactly as instructed by the ticket.

**Live verification performed** (not typecheck-only): typecheck and lint clean (the one pre-existing `react-hooks/exhaustive-deps` warning on a different, untouched effect was confirmed present before this change too via `git stash`, not introduced by it).
- Real browser test: sent a message with a unique marker through the actual chat UI, confirmed it appeared, then did a full page **reload** — the marker was still present, loaded from the real DB via the new mount effect, not from React state surviving in memory. Cross-checked directly in the database: a real `conversations` row and both the user and assistant `messages` rows existed with the correct `tenant_id`.
- Second test: a **brand-new browser context with no localStorage at all** (simulating a fresh device) still resumed the same conversation via the DB-fallback path — proving the "existing open conversation... loaded... not started fresh" criterion doesn't depend on `localStorage` alone.
- Test conversation and its messages deleted from the database afterward; nothing test-related left behind.

## M1-06 — REQUIREUSER() AUDIT ON REMAINING API ROUTES (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-06. Branch: `milestone-1-reliability`.

**Method**: every route under `app/api/**` (23 total) was read in full and classified: does it call `requireUser()` (or an equivalent real auth mechanism)? If it touches tenant-scoped/sensitive data, does the query actually filter by the caller's own tenant, or just check "is someone logged in"? This distinction matters because `lib/supabase/client.ts`'s shared client resolves to the service-role key in every server context — RLS is not a backstop for these routes.

**Finding — no missing auth**: all 23 routes already call `requireUser()` or, for the one legitimate cron/scheduler endpoint (`tasks/process`), a fail-closed shared-secret header check. Zero routes were reachable with no authentication at all.

**Finding — 2 real IDOR gaps, fixed**: `app/api/stream/mission` and `app/api/tasks/queue` both accept an attacker-controlled `missionId` query parameter and, unlike their sibling `app/api/missions/[id]/timeline` (already fixed in an earlier pass), never verified the caller actually belongs to that mission's tenant before returning its data — an authenticated user from any tenant could stream another tenant's mission timeline (`stream/mission`, for up to 5 minutes) or read another tenant's task queue (`tasks/queue`) by passing a guessed/known mission ID. Fixed by applying the exact same `isTenantMember()` pattern already proven for `missions/[id]/timeline`.

**Finding — 16 routes authenticated but not tenant-scoped, flagged as an open decision, not resolved**: `missions/summary`, `runtime/activity`, `runtime/health`, `runtime/state`, `stats/dashboard`, `stats/knowledge`, `stats/memory`, `stats/providers`, `stats/tools`, `stats/workflows`, `tasks/active`, `tasks/queue` (no-`missionId` case), `agents/departments`, `agents/managers`, `agents/registry`, `agents/registry/[id]`. These are not per-record lookups by attacker-controlled ID (the IDOR shape just fixed above) — they're aggregate/global operational views (dashboard stats, runtime state, the shared agent registry) backed by service functions (`lib/dashboard/dashboardService.ts`, `lib/dashboard/healthService.ts`, `lib/swarm/runtimeStore.ts`, `lib/agents/agentRegistryService.ts`) that have **zero** tenant filtering anywhere in them. Whether this is correct depends on a product decision this document cannot make unilaterally: the agent registry is explicitly documented elsewhere in this file (and in `CLAUDE.md`) as global/shared-workforce **by design** — one physical agent roster serving every tenant, not per-tenant. If the dashboard/stats/runtime views are meant to follow that same "global ops view" model, these 16 routes are correctly scoped as-is. If they're meant to show a tenant their *own* missions/tasks/usage specifically (which the product's multi-tenant SaaS direction may eventually require), all 16 need tenant filtering added at the service-function layer. **This decision is explicitly deferred to Amro rather than guessed** — implementing a broad tenant-scoping refactor across 4 service files on a guess would risk breaking the intended shared-ops-dashboard UX if that reading is wrong.

**Route classification table** (condensed; PROPERLY-SCOPED entries were already fixed in an earlier pass and are included for completeness):

| Route | Classification | Notes |
|---|---|---|
| `missions/[id]`, `missions/[id]/timeline`, `missions/[id]/cancel` | PROPERLY-SCOPED | `isTenantMember()` check present (earlier pass) |
| `stream/mission`, `tasks/queue` (with `missionId`) | PROPERLY-SCOPED (this pass) | `isTenantMember()` check added |
| `settings/validate-provider` | PROPERLY-SCOPED | Not tenant data at rest — proxies the caller's own submitted key; auth + rate limiting (M1-03) is sufficient |
| `tasks/process` | OTHER-AUTH (by design) | Shared-secret cron auth, fails closed if unset; not a user session |
| `missions/summary`, `runtime/activity`, `runtime/health`, `runtime/state`, `stats/dashboard`, `stats/knowledge`, `stats/memory`, `stats/providers`, `stats/tools`, `stats/workflows`, `tasks/active`, `tasks/queue` (no `missionId`), `agents/departments`, `agents/managers`, `agents/registry`, `agents/registry/[id]` | AUTHENTICATED, GLOBAL DATA — decision needed | See finding above |

**Live verification performed** (not typecheck-only): typecheck and lint clean. Real two-tenant test: created a real mission owned by the internal tenant, a throwaway second tenant/user, then hit both fixed routes as the second tenant with the internal tenant's mission ID — both correctly returned `404`. The same routes, called by the mission's actual owner, returned `200` (`stream/mission` with real `text/event-stream` headers). Test mission, test user, and test tenant deleted afterward.

## M1-07 — MINIMUM VIABLE AUTOMATED TEST COVERAGE (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-07. Branch: `milestone-1-reliability`.

**Runner choice**: Vitest, per the ticket's own suggestion, confirmed against the current `package.json` before deciding — this project had zero test infrastructure (no `test` script, no test runner in `dependencies`/`devDependencies`, no test files anywhere). Installed as a devDependency.

**Scope, deliberately narrow**: 3 test files in `tests/`, all real integration tests against the live Supabase project (matching this project's own established "live verification, not typecheck-only" discipline — mocking Supabase would test nothing real):
- `tests/tenant-isolation.test.ts` — a real memory owned by the internal tenant; a throwaway second tenant's session cannot `SELECT` it, cannot `INSERT` a `memory_links` row referencing it (real `42501` RLS rejection), and neither can a genuinely unauthenticated (anon-role) client.
- `tests/auth-gate.test.ts` — `requireUser()` (the single verification helper every tenant-scoped API route relies on, since the shared Supabase client resolves to service-role server-side) against a real `Request` object: rejects no-token and garbage-token cases, accepts a real session token and returns the correct user id. `isTenantMember()` against a real membership (true) and a nonexistent tenant (false).
- `tests/mission-lifecycle.test.ts` — the exact status/progress rollup bug found and fixed earlier in this milestone (a mission could stay stuck at `status: 'executing'` forever even after every task resolved). Creates a real mission + 2 real tasks, calls `recalculateProgress()` before and after moving both tasks to `completed` (without needing a live AI provider call, which would make this test slow and flaky), and asserts the mission genuinely reaches `status: 'completed'`/`progress: 100` in the database, plus a real `mission_completed` timeline event.
- `tests/helpers.ts`: shared helpers — a real per-token Supabase client (`clientAs()`, mirroring `requireUser()`'s own token-scoped client pattern) so tests exercise real RLS rather than the service-role client, a genuine anon-role client, dev-tester sign-in, and throwaway-tenant creation/cleanup (reusing the exact pattern manually run by hand throughout this whole milestone's other tickets, now codified as a re-runnable automated test instead of a one-off script).
- `vitest.config.ts`: path alias matching `tsconfig.json`'s `@/*`, and manual `.env`/`.env.local` parsing into `process.env` (avoided importing `vite`'s `loadEnv()` directly since `vite` isn't hoisted to a directly type-resolvable location here — would have broken `tsc --noEmit`, not just this file).
- `npm test` added to `package.json` (`vitest run`); `CLAUDE.md`'s "Run available tests" line updated from "no automated test framework exists" to the real command and what it covers.

**Live verification performed**: `npm test` — all 9 tests across all 3 files pass in ~3.5s against the real, live Supabase project, not a mock. Confirmed no test data was left behind afterward (`afterAll` cleanup hooks in all 3 files; verified directly via a service-role query for any stray `M1-07`-titled rows).

## M1-08 — LOCAL N8N + CLOUDFLARED DEV RUNBOOK (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-08. Branch: `milestone-1-reliability`. Documentation only — no code changes, matching the ticket's explicit scope.

**What changed**: `docs/runbooks/local-n8n-dev-setup.md` written by directly inspecting the actual running infrastructure on Amro's machine (`docker inspect n8n`, `Get-CimInstance Win32_Process` for the live `cloudflared` command line), not from memory or assumption:
- Real container config (image `docker.n8n.io/n8nio/n8n:latest`, port `5678:5678`, persistent named volume `n8n_data`, restart policy `no` — meaning it does not auto-start after a reboot).
- The real, currently-running `cloudflared tunnel --url http://localhost:5678` command, confirmed to be a **quick tunnel** (not named) — cross-checked against the live `app_settings.n8n_url` value (`https://jesse-coins-data-mounting.trycloudflare.com`, a `trycloudflare.com` domain, which only quick tunnels produce).
- Where the URL/API key get configured: `app_settings.n8n_url`/`n8n_api_key`, via the real Settings UI section confirmed present in `app/settings/page.tsx` (not by editing the database row directly).
- What to do when the tunnel URL changes (every restart, since it's a quick tunnel): restart cloudflared, update the URL in Settings, re-validate.

**Left as an open decision, not resolved here**: the ticket explicitly asks whether to move to a named tunnel (stable URL, one-time Cloudflare account setup) instead of the current quick tunnel (zero setup, but the URL changes every restart). This requires Amro's own Cloudflare account/domain decision and was not guessed at — documented as a clearly-flagged tradeoff in the runbook itself, to be resolved and the runbook updated once Amro decides.

## M1-09 — INTERNAL OPERATOR MODE DESIGN + FIRST CAPABILITY (2026-08-26)

**Ticket**: `docs/BACKLOG-M1.md` M1-09. Branch: `milestone-1-reliability`. Final ticket of Milestone 1.

**Design, confirmed per `docs/GOVERNANCE.md` Section 4**: operator-mode capabilities (ones TEMO uses on Amro's own behalf — creating/modifying real external infrastructure — never a client tenant's) are scoped to the internal tenant (`00000000-0000-0000-0000-000000000001`) only. New `lib/governance/internalTenant.ts` exports `INTERNAL_TENANT_ID` (previously only ever an inline literal repeated across several files) and `assertInternalTenant(tenantId)` — the single function every future operator capability's handler should call first. Deliberately fail-closed: a missing/`null`/`undefined` tenantId is rejected exactly like a real client tenant, never treated as "assume internal."

**First capability, matching the ticket's own example**: `operator.n8n.createWorkflowFromDescription` (`lib/tools/operator-tools.ts`) — drafts and creates a real n8n workflow from a plain-language description. Deliberately narrow, not a broad "give TEMO my API keys" implementation:
- New `operator` tool-registry category (`lib/tools/types.ts`), so operator-only capabilities are visually/structurally distinguishable from tenant-facing ones in the registry, not just by convention.
- `requiresApproval: true` — goes through the existing `lib/governance/approvals.ts` gate, already wired into `toolExecutor.execute()` (no new approval mechanism built).
- The handler calls `assertInternalTenant(context.tenantId)` as its very first line, before anything else.
- Workflow drafting is constrained to a small, safe node vocabulary (`manualTrigger`, `set`, `code`, `if`, `noOp` — no HTTP/credential-requiring node types for this first pass, so a drafted workflow can never fail on a secret it doesn't have) via one AI call, then reuses the existing, already-verified-this-milestone `n8n.workflows.create()` — no duplicate n8n integration logic. A malformed/unparseable AI response falls back to a safe single-trigger-node workflow rather than failing the whole capability.

**Explicitly not reusable for a client tenant — proven structural, not policy**: the tenant assertion lives inside the handler, which only runs *after* the approval gate. This means the ordinary path (approval never granted) already blocks a client tenant, but the actually load-bearing guarantee is what happens if a human mistakenly approves a client tenant's request anyway — live-verified below that even then, execution is still refused. Registering the tool unconditionally (rather than only registering it for the internal tenant somehow) was a deliberate choice: the registry itself was never meant to be the security boundary here, `assertInternalTenant()` is — so the guarantee holds regardless of how the tool ever gets reached in the future.

**Live verification performed** (not typecheck-only): typecheck and lint clean.
- Real client (throwaway) tenant → first call correctly gated to `pending approval`. Approved anyway (simulating a mistaken human click) → retried with the approved id → **still rejected**, `"This capability is restricted to the internal operator tenant."` — the structural guarantee, proven, not assumed.
- Real internal tenant → first call gated to `pending approval`, approved for real, retried → **genuine success**: a real n8n workflow was created (cross-checked directly via n8n's own API — `nodes: [{"type":"n8n-nodes-base.manualTrigger", ...}]`, the safe fallback path, since the test description didn't map cleanly to the constrained node vocabulary — itself a correct, honest outcome, not a failure). Test workflow and all test approval/tenant rows deleted afterward.

## M1-DECISIONS — CLAUDE COWORK REVIEW OUTCOME, MILESTONE 1 CLOSED (2026-08-26)

Claude Cowork (Technical Manager) reviewed all 9 Milestone 1 commits on `milestone-1-reliability` and approved the branch in full. Three items that were explicitly left as open decisions during implementation were resolved during that review, plus one additional gap the review itself surfaced. None of these required new application code beyond what's noted — this section is the record of the decisions themselves.

**1. M1-02 — budget ceiling.** The $50/month placeholder for the internal tenant stays as-is. Reasonable for now since every AI provider in use is free-tier (`docs/GOVERNANCE.md` Section 5), so the ceiling has no real cost impact today. **Explicitly provisional, not final** — revisit this figure when either (a) a paid provider gets configured, or (b) cloud/paid voice (TTS/STT) is enabled, since both introduce real per-call cost this number was never sized against.

**2. M1-06 — the 16 globally-scoped routes.** Left as-is for now: a global ops view is an acceptable posture *while the internal tenant is the only real user of the system*. This is a temporary allowance, not a permanent architectural answer — it must be closed before any external beta user is invited, even a single friendly one. Tracked as `docs/BACKLOG-M2.md`'s `M2-01`, marked **Blocking** for any beta invite.

**3. M1-08 — tunnel choice.** Move from the quick tunnel to a named Cloudflare tunnel — the stable hostname removes the repeated-reconfiguration friction of a URL that changes on every `cloudflared` restart. `docs/runbooks/local-n8n-dev-setup.md` updated with the full named-tunnel setup procedure. **Not yet executed**: creating the tunnel requires `cloudflared tunnel login`, an interactive browser OAuth flow against Amro's own Cloudflare account — outside what Claude Code can perform. The quick tunnel remains the live configuration in `app_settings.n8n_url` until that one step happens, after which the remaining setup (steps 2–4 in the runbook) can be completed by either Amro or Claude Code.

**4. New gap, surfaced during review, not part of the original three decisions.** M1-03's rate limiting only covers the 2 `app/api/**` routes that can trigger AI/tool spend. But the primary chat/mission path (`orchestrate()`) is called directly from `app/chat/page.tsx` client-side — it never goes through an API route at all — so the actual highest-volume path in the product has no rate limiting whatsoever. Tracked as `docs/BACKLOG-M2.md`'s `M2-02`.

**Milestone 1 status**: all 9 tickets `Merged` in `docs/BACKLOG-M1.md`. Branch `milestone-1-reliability` merged to `main` the same day.

## M2-01 — TENANT-SCOPE THE 16 GLOBALLY-SCOPED API ROUTES (2026-08-26)

**Ticket**: `docs/BACKLOG-M2.md` M2-01. Branch: `milestone-2-beta-readiness`. Priority: Blocking (before any external beta user).

**Method**: each of the 16 routes M1-06 left as "authenticated, not tenant-scoped" was traced to its actual data source, and given a definitive resolution — no route was left in the undecided middle M1-06 explicitly flagged. Two outcomes only: real tenant filtering added (where the underlying data genuinely belongs to one tenant), or documented as intentionally global (where it doesn't).

**New shared helper**: `getCallerTenantId(userId, requestedTenantId?)` (`lib/auth/apiAuth.ts`) — resolves which tenant a dashboard-style route should scope to. An explicit `?tenantId=` is verified via `isTenantMember()` (403 if not a member); otherwise falls back to the caller's own membership (the common single-tenant-per-user case resolves cleanly; a user in zero or multiple tenants gets `null`, since guessing which one would be as wrong as showing them combined).

### 8 routes — real tenant filtering added

| Route | What changed |
|---|---|
| `missions/summary` | `listMissions()` already had an unused `tenantId` param (added in an earlier pass, never threaded through) — now actually passed from the caller's resolved tenant. |
| `runtime/state` | New `getRuntimeStateForTenant()` (`lib/swarm/runtimeStore.ts`) — `runtime_state` is a literal global singleton row with no `tenant_id` column (predates V1), so mission-specific fields (`currentMissionId`, `missionProgress`, `timelineSummary`) are redacted when the current mission doesn't belong to the caller's tenant, via a lookup against `missions` (which is tenant-scoped) — a real fix without a schema migration. |
| `runtime/activity` | New `getRuntimeActivityForTenant()` — `runtime_activity` also has no `tenant_id`; rows tied to a mission the caller doesn't own are filtered out via the same missions-lookup pattern. Rows with no `missionId` (generic system events) remain visible to everyone, since they carry no tenant-specific content. |
| `tasks/active` | `getReadyTasks()` (`lib/swarm/missionService.ts`) — `mission_tasks` has no `tenant_id` of its own either; an inner join against `missions` scopes the result. |
| `tasks/queue` | The `missionId`-provided case was already fixed in M1-06; the no-`missionId` (current-mission) case now goes through the same `getRuntimeStateForTenant()` redaction as `runtime/state`. |
| `stats/dashboard` | `totalMissions`/`totalTasks` now tenant-scoped; `totalAgents`/`activeManagers` intentionally stay global (shared workforce, see below). |
| `stats/memory` | `memoryStore.list()`/`countByType()` gained a `tenantId` filter (previously had none at all — the service-role client server-side made this a genuine cross-tenant leak of `total`/`byType`, not just an oversight). `embeddings`/`links`/`events` sub-counts remain global — those tables key off `memory_id`, not a direct `tenant_id`; a fully correct per-tenant count would need a join through `memories` and was judged disproportionate for this ticket. Documented in code, not silently left inconsistent. |
| `stats/providers` | Usage counts (`usage_ledger` has real `tenant_id`) now tenant-scoped. Provider **configuration** (which providers are set up, active model) stays global — intentionally, see below. |

**Live-verified**, real two-tenant tests against the running dev server: a throwaway second tenant never saw the internal tenant's mission ID, task ID, or memory ID across `missions/summary`/`runtime/state`/`runtime/activity`/`tasks/active`/`tasks/queue` (5/5 clean). Numeric counts confirmed to differ correctly: `stats/dashboard`'s `totalMissions` (22 for the internal tenant vs. 0 for the throwaway tenant), `stats/memory`'s `totalMemories` (11 vs. 0), `stats/providers`' `usageCount` for `gemini` (16 vs. 0). All test tenants/users/data deleted afterward.

### 8 routes — documented as intentionally global, not filtered

| Route | Why global |
|---|---|
| `agents/departments`, `agents/managers`, `agents/registry`, `agents/registry/[id]` | The shared agent registry — already explicitly documented in `CLAUDE.md` and this document as global-by-design ("shared workforce... never one physical agent per customer"). This ticket doesn't change that; it confirms it as the final, permanent answer rather than an implicit assumption. |
| `runtime/health` | Aggregate infrastructure health only (provider-configured/not, raw counts of memories/facts/workflows, tool registry size) — no mission titles, no business content, nothing that identifies a specific tenant's data. Traced through `lib/dashboard/healthService.ts` line by line to confirm this before deciding, not assumed from the route name. |
| `stats/knowledge` | `structured_facts` has no `tenant_id` column at all (confirmed by direct schema inspection) — extracted knowledge facts are a shared knowledge base today, architecturally, not per-tenant. Adding one would be a schema-level project disproportionate to this ticket; documented as the honest current state rather than half-fixed. |
| `stats/tools` | The tool registry itself (which tools exist, their categories) is shared workforce infrastructure, same framing as the agent registry — Temo's tools are shared team capabilities, not a per-tenant private inventory. The execution-count sub-fields (`mission_timeline` events) *could* be tenant-filtered via a join, but doing that while leaving the registry listing global would be an inconsistent half-measure; kept coherently global for this pass. |
| `stats/workflows` | `workflow_registry` has no `tenant_id` — n8n integration is currently account-wide (one shared n8n instance/credential set per `docs/runbooks/local-n8n-dev-setup.md`), not per-tenant, so a shared workflow catalog is the architecturally honest framing, not an oversight. |

**Not touched**: `missions/[id]`, `missions/[id]/timeline`, `missions/[id]/cancel`, `stream/mission`, `tasks/queue` (missionId case), `settings/validate-provider` — already `PROPERLY-SCOPED` per M1-06.

### M2-01-fix — multi-tenant-membership fallback gap closed (2026-08-26, same day)

Claude Cowork's review found a real gap in `getCallerTenantId()`: when a caller belongs to 2+ tenants and doesn't pass `?tenantId=`, it returned the identical `{ tenantId: null, forbidden: false }` shape as the legitimate zero-membership case — and every one of the 8 filtered routes above treated a `null` tenantId as "no filter needed," silently falling back to their fully unfiltered/global code path. A user with genuine access to two tenants (e.g. an owner account with both the internal tenant and a client tenant — `tenant_members` has no unique constraint preventing this, so it's a real reachable case, not theoretical) would have seen every tenant's data combined, not a safe empty result.

Fixed: `getCallerTenantId()` now returns a third, distinct outcome — `ambiguous: true` — for the 2+ membership case, so it can no longer be silently conflated with "zero memberships, correctly empty." All 8 call sites updated to check `ambiguous` and return `400` (`"You belong to multiple tenants — pass ?tenantId= explicitly"`) immediately after the existing `forbidden`/403 check, before ever reaching their data-fetching code.

**Live-verified**: created a real user with genuine membership in two real tenants (the internal tenant plus a fresh throwaway one), hit all 8 routes with no `?tenantId=` — every one returned `400`, none fell through to combined/unfiltered data. Retried the same 8 routes with `?tenantId=<one of their real tenants>` — all returned `200` with correctly scoped results. Test tenant, user, and memberships deleted afterward.

## M2-02 — RATE LIMITING ON THE PRIMARY CHAT/MISSION PATH (2026-08-26)

**Ticket**: `docs/BACKLOG-M2.md` M2-02. Branch: `milestone-2-beta-readiness`.

**Architectural decision, made and documented before implementing, per the ticket's explicit instruction**:

`orchestrate()` runs entirely client-side (`app/chat/page.tsx` calls it directly), so any rate-limit check placed inside `orchestrate()` itself, or anywhere in client-side `lib/`, is trivially bypassable by a caller who skips the app entirely and calls the underlying functions — or the network requests those functions make — directly. Tracing the actual call path further surfaced something broader than the ticket asked about: **`supabase/functions/ai-chat` (the edge function every real AI call ultimately proxies through) had zero authentication of its own** — it trusts any request bearing the public anon key, meaning it could already be called directly today, bypassing not just rate limiting but also M1-02's budget gate (which lives in client-side `lib/ai/ai-provider.ts`, upstream of this edge function, not inside it).

Two designs were considered:
1. **Per-tenant rate limiting**, which would require threading real user/tenant identity (an access token + tenant id) through this edge function and verifying it there — the only way to make a per-tenant check genuinely unbypassable. Doing this correctly means also threading tenant context through every internal AI call site that currently has none: `lib/tools/planner.ts`, `lib/memory/summarizer.ts`, `lib/crew/ai-intent-analyzer.ts` all call `chatWithFallback`/`streamWithFallback` with `tenantId: null` today — a pre-existing gap, not something this ticket introduced, but fixing per-tenant rate limiting properly would require touching all of them. Judged too large a refactor for Milestone 2's explicitly "short and focused, beta-readiness not features" scope.
2. **Per-IP rate limiting, enforced unconditionally inside the edge function itself** — chosen. Requires zero changes to any of the ~12 existing `chatWithFallback`/`streamWithFallback` call sites, is genuinely unbypassable (this edge function is the only path to a real provider call — a malicious caller skipping `orchestrate()`/the browser entirely still has to go through this exact endpoint), and matches the same pattern already used for `app/api/tasks/process` in M1-03, where a clean per-tenant caller concept didn't exist either.

**What changed**:
- `supabase/functions/ai-chat/index.ts`: new `checkIpRateLimit()`, called unconditionally at the top of the request handler, before the body is even parsed — reuses the exact `check_rate_limit()` Postgres function from M1-03 (`lib/api/rateLimit.ts`'s server-side counterpart), keyed `ai-chat:ip:<ip>` (60-token burst, 60/min steady refill — sized for real legitimate multi-call-per-message traffic, not a single request). Fails open on any infrastructure error, same posture as M1-03. A block returns `429` with a distinguishing `{"code":"rate_limited"}` marker.
- `lib/ai/ai-provider.ts`: `AIProviderError` gained an optional `code` field. When the edge function returns the `rate_limited` marker, `chat()`/`chatStream()` throw immediately instead of retrying (the M1-03-style retry loop would otherwise burn 3 attempts against the identical block), and `chatWithFallback()`/`streamWithFallback()`'s provider-fallback loop stops immediately instead of cycling through every remaining provider — since the block applies identically to all of them (checked before any provider is even selected), trying the rest would just repeat the same result. `getFriendlyError()` surfaces the edge function's precise `"Too many requests. Try again in Ns."` message instead of the older generic 429 wording.

**Left explicitly open for Claude Cowork**: true per-tenant rate limiting (option 1 above) remains a real, separate follow-up if wanted — it would also be the natural moment to thread tenant context through the 3 internal AI call sites that currently lack it, and would let M1-02's budget gate be re-homed into the edge function too (closing the same "client-side-only gate" class of concern for the budget check, not just rate limiting). Not implemented here; flagged for an explicit scoping decision rather than triggered unilaterally.

**Live verification performed** (not typecheck-only): typecheck and lint clean, edge function redeployed. Fired 70 truly-parallel requests directly at the deployed edge function (bypassing the app entirely, using an invalid provider id so requests fail fast on validation rather than spending real provider quota) — 61 got through to the validation step, the remaining 9 were blocked with a real `429`/`{"code":"rate_limited"}`, consistent with the 60-token burst configuration. Confirmed a real legitimate chat call (`chatWithFallback()` with a real prompt) still succeeds end-to-end after the change — a genuine Gemini response, not mocked.

## M3-01 — DIAGNOSE AND FIX CHAT LATENCY / SILENT NON-RESPONSE (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-01. Branch: `milestone-3-experience`.

**Root causes found by live testing against the real provider APIs (not just code inspection)**:

1. **NVIDIA's configured model was dead**: `nvidia/nemotron-mini-4b-instruct` returned a real HTTP `410 Gone` — "has reached its end of life on 2026-08-26T09:00:00Z" (the exact day this was tested). NVIDIA also retired the entire `meta/llama-3.1-*` family the same day, invalidating several of the static fallback list's entries too.
2. **OpenRouter's configured model was `openrouter/auto`**, which routes to paid models — this account has never purchased credits, so every call failed with `402 Insufficient credits`. `openrouter/auto` never had a code-level "stale name" problem; it was a configuration choice that silently required a paid balance that doesn't exist.
3. **The real "sometimes doesn't respond at all" bug**: Gemini's and Groq's currently-configured models (`gemini-3.6-flash`, `openai/gpt-oss-120b`) are "thinking"/reasoning models — confirmed live, both return a `reasoning`/`reasoning_content` field alongside `content`. When `maxTokens` is small enough that reasoning consumes the whole budget (reproduced live: `maxTokens: 20` on both), the provider returns a genuine HTTP `200` with **empty visible content** and `outputTokens: 0`. This was previously treated as a successful response by `chatWithFallback()`/`streamWithFallback()` — no error was ever thrown, so the chat UI simply rendered nothing. This is the silent-non-response bug, not a hang.
4. Separately, Gemini's `gemini-3.6-flash` showed real (if intermittent) upstream latency variance: repeated live calls at the app's real default `maxTokens: 2048` ranged 2.1s–5.6s, with one run in eight hitting the edge function's 30s upstream timeout outright (`504`). Under the pre-fix retry policy (3× exponential backoff **per provider**, not skipping providers with a known-bad recent track record), a single slow/erroring provider near the front of the chain could add tens of seconds before the fallback chain even reached a healthy provider.
5. `lib/crew/ai-intent-analyzer.ts`'s `AIIntentAnalyzer.analyze()` **is** in the synchronous hot path of every single chat message — confirmed by tracing `crew-coordinator.ts`'s `routeAndRespond()`, which calls `this.engine.route()` (→ `AIIntentAnalyzer.analyze()` → a full `route()` + `chatWithFallback()` round trip) before the Context Manager or the real response generation even start. A slow/erroring provider here doubled the latency exposure of the *entire* pipeline, not just routing, with no upper bound of its own.

**Fixes**:
- **Data fix** (`supabase/migrations/20260826140000_fix_stale_provider_models.sql`): `nvidia_model` → `nvidia/nemotron-3-super-120b-a12b` (confirmed live: 200, real content, ~1s), `openrouter_model` → `nvidia/nemotron-3-super-120b-a12b:free` (an explicit free-tier model, confirmed live: 200, real content, ~350ms — avoids the `openrouter/auto` credits problem entirely).
- **Empty-content guard** (`lib/ai/ai-provider.ts`): a successful provider response whose `content` is empty/whitespace-only is now treated as a failure — health is recorded as a failure, and the fallback loop continues to the next provider/model instead of returning a blank "success". Applied to both `chatWithFallback()` and `streamWithFallback()`.
- **Health-based skip-before-retry** (`lib/ai/ai-provider.ts`): before attempting a provider/model pair, `isSkippableUnhealthy()` checks `healthTracker.getHealth()`; a pair with ≥3 consecutive recent failures within the last 5 minutes is skipped outright — no request attempt, no 3× retry/backoff — and the loop moves straight to the next candidate. Previously the health tracker only *recorded* failures (used by the Dynamic Model Router's scoring) but nothing consulted it to skip a doomed retry inside `chatWithFallback`/`streamWithFallback` itself.
- **Intent-analyzer hard timeout** (`lib/crew/ai-intent-analyzer.ts`): the classification call is raced against a 4-second timeout (`Promise.race`); on timeout it falls back to the existing keyword-based analyzer, same as any other failure. **Decision**: intent classification legitimately has to complete before the correct agent's system prompt can be built, so it can't simply be moved off the critical path without restructuring routing itself (judged out of this ticket's scope) — a hard timeout bounds the damage instead of removing the dependency. Also bumped its `maxTokens` from 300 → 500 as defense-in-depth against the same reasoning-tokens-eat-the-budget failure mode.

**Live verification performed** (not typecheck-only): direct calls against the real provider APIs confirmed each root cause and each fix (NVIDIA 410→200, OpenRouter 402→200, Gemini/Groq empty-content reproduced and root-caused to reasoning-token budget exhaustion). End-to-end through the real chat UI (Playwright, dev-auto-login session, `/chat`): 10 real messages sent back-to-back post-fix, all 10 received real non-empty content, none timed out, none silently failed — first visible content averaged ~3.1s (min 0.49s, max 5.79s), well under the 30s upstream ceiling. `npm run typecheck` clean.

**Left open, not implemented here**: `gemini-3.6-flash`'s per-call latency variance (2–6s typical) is inherent to a reasoning-capable "thinking" model and wasn't changed — M3-02 (fast-first-response guarantee) is the ticket that addresses perceived responsiveness on top of this.

## M3-02 — FAST-FIRST-RESPONSE GUARANTEE (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-02. Branch: `milestone-3-experience`.

**Gap found by tracing the real chat pipeline**: `app/chat/page.tsx`'s assistant placeholder bubble (`streaming: true`, `content: ''`) rendered as a visually empty box for the entire pre-first-token window — indistinguishable from a frozen page. For the mission pipeline specifically (`lib/swarm/unifiedOrchestrator.ts`'s `runMissionPipeline()`), the gap was worse: `orchestrate()` is a single `await` with zero intermediate signal back to the caller until the *entire* mission (launch + execute every task) finishes — unlike the simple pipeline, which already streams live progress into the chat UI via `CrewCoordinator`'s `onTimeline`/`onActivity` callbacks (`routeAndRespond()` calls these synchronously as it progresses, confirmed by tracing `crew-coordinator.ts`).

**What changed**:
- `app/chat/page.tsx`: new `TypingIndicator` component (three pulsing dots, agent-colored) renders inside the assistant bubble whenever `message.streaming && !message.content` — gives a real, immediate (0ms, no LLM round trip) visible acknowledgment the instant the bubble is created, which streamed content then replaces as soon as the first tokens arrive.
- `lib/swarm/unifiedOrchestrator.ts`: `OrchestrateOptions` gained an optional `onDecision?: (pipeline, reason) => void` callback, fired synchronously right after the Decision Engine classifies the request (`makeDecision()`), before either pipeline actually runs.
- `app/chat/page.tsx`: `send()` passes an `onDecision` handler that, when `pipeline === 'mission'`, immediately posts a real acknowledgment message ("Got it — this needs a full mission, so I'm breaking it down and getting to work. I'll follow up here with the result.") as its own chat bubble — closing the exact gap above, with zero changes to the mission engine itself.

**Live verification performed** (not typecheck-only): through the real chat UI (Playwright, dev-auto-login session) — a plain question shows the typing indicator immediately and real content within the same latency window measured in M3-01 (avg ~3.1s, all well under 30s); a mission-triggering request ("Build a complete end to end marketing automation pipeline and then generate a report") shows the mission acknowledgment message appear within ~2.5s, well before the underlying mission execution completes. Screenshots confirm both. `npm run typecheck` clean.

## M3-04 — RENAME COMMAND DECK TO MAIN DASHBOARD; FIX THE G-BRAIN MINI-VIEW LINK (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-04. Branch: `milestone-3-experience`.

**What changed**:
- `components/temo/left-nav.tsx`: `NAV_ITEMS`'s `/dashboard` entry label `'Command Deck'` → `'Main Dashboard'`.
- `components/temo/org-chart.tsx`: the G-Brain page's own link to `/dashboard` relabeled `'Command Deck'` → `'Main Dashboard'`.
- `components/temo/command-deck.tsx`: the hero-bridge's static "LIVE COMMAND BRIDGE /// NEURAL SYNCHRONIZATION" caption removed entirely, replaced with a `Network`-icon "G-Brain" button (reusing the existing `.gbrain-link` style already defined in `app/globals.css` but never wired to anything live) that navigates to `/` — the hero-bridge's live mini team view is now framed as a preview of the full G-Brain page, with this button as the obvious way to see it.
- Remaining `"Command Deck"` occurrences left as-is are code comments, not user-facing strings (out of the ticket's scope, which named page titles/`NAV_ITEMS`/UI strings specifically).

**Live verification performed**: real screenshots of both `/` and `/dashboard` confirm the rename (`components/temo/left-nav.tsx` and `org-chart.tsx`'s link both read "Main Dashboard"), and clicking the new G-Brain button from Main Dashboard lands on the real G-Brain page with live data intact. `npm run typecheck` clean.

## M3-05 — VOICE TRIGGER REDESIGN + CHAT-PAGE MIC BUG FIX (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-05. Branch: `milestone-3-experience`.

**Confirmed bug**: `app/chat/page.tsx`'s `InputBar` `onVoiceToggle` was wired to `() => router.push('/settings')` — the mic button redirected to Settings instead of starting voice input. Fixed: it now calls `voiceManager.startListening()`/`stopListening()` based on `useVoiceStore`'s `isListening`, the same toggle every other voice entry point in the app already uses (`components/layout/voice-hud.tsx`). Live-verified: clicking the mic no longer navigates (`page.url()` stays on `/chat`) and the shared voice store's status genuinely flips to `LISTENING` (visible in the top bar across the whole app, confirming the real underlying session activated, not a local-only UI toggle).

**Investigation — where the "Tap to Speak" control the ticket described actually lives**: the true `/` route (`components/temo/org-chart.tsx`, G-Brain) has no voice control at all — its Temo node's "READY · ACTIVE LISTENING" text is a hardcoded decorative kicker string, not a real control. The actual "Tap to Speak" widget with several icon-only, unlabeled sub-buttons (Chat/Mute/Mic/Stop/Voice/Settings, distinguishable only by `aria-label`, matching the ticket's "discovered only by trial and error" complaint) is `components/layout/voice-hud.tsx`, rendered globally by `TopNav` on every page except `/` — including `/dashboard` (Main Dashboard), which is where a dev-auto-login session actually lands and where the real central Temo hologram avatar lives (`command-deck.tsx`'s hero-bridge). That is the redesign target.

**What changed**:
- `components/temo/command-deck.tsx`: new `VoiceTrigger` component replaces the static Sparkles icon inside the "holo-core" badge directly beneath Temo's avatar — same 52px circular footprint in idle state (zero layout shift), now a real clickable mic button wired to the same `voiceManager` start/stop toggle. Clicking it expands (via `position:absolute`, so it doesn't push surrounding content) into a recording-bar: an animated 5-bar waveform reacting to listening/thinking state, a pulsing stop button, and live transcript/status text — built from this app's own existing cyan/glow visual language (`temo-cyan` color, the same glow treatment already used throughout G-Brain/Command Deck), not a copied ChatGPT look. The central-hologram container's `z-index` was bumped (`5`, was tied at `2` with the sibling `.agent-row`) after live-testing found the expanded recording bar's Stop button was unclickable — a "Corporate Office" cluster label from `.agent-row` was painting on top of it and intercepting the click.
- `components/temo/top-nav.tsx`: `isDashboard` (the flag that hides the global `VoiceHud`) now also matches `/dashboard`, not just `/` — avoids two competing, redundant voice entry points on the same page now that Main Dashboard has its own dedicated trigger.

**Explicitly not changed**: the underlying voice engine (`lib/voice/voice-manager.ts`, `VoiceRecorder`/`VoicePlayer`, the free browser Web Speech API) — purely a trigger/visual change, per the ticket's scope.

**Live verification performed** (not typecheck-only): real clicks through the actual `/chat` and `/dashboard` pages (Playwright, microphone permission granted) — chat-page mic starts a real listening session without navigating away; Main Dashboard's new trigger starts listening (top-bar status flips to `LISTENING` app-wide, waveform/status text render correctly), and stopping it collapses cleanly back to the idle mic badge with no leftover click-blocking or layout shift. Screenshots confirm all three states (idle, active/expanded, stopped). `npm run typecheck` clean.

## M3-07 — FIX "NO AGENT SELECTED" VOICE ERROR ON MAIN DASHBOARD (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-07. Branch: `milestone-3b-voice-fixes`.

**Root cause, confirmed by tracing the real call chain (not the ticket's initial hypothesis)**: the ticket suspected `voiceManager.getActiveAgent()` (reads `useDashboardStore`) as the failure point, but that function only affects *which TTS voice* to speak with (`speak()`'s `agent?.voice` is optional-chained — a missing agent there degrades gracefully to default settings, it was never the throw site). The real throw site is `crew-coordinator.ts`'s `generateResponse()`/`generateToolResponse()`/`generateStreamResponse()` (~lines 402/445/492), each `throw new Error('No agent selected')` when `this.registry.getById(routing.selectedAgentId)` returns `undefined`. `this.registry` is `CrewCoordinator`'s own internal `AgentRegistry`, populated only by `crewCoordinator.init(agents)` — and **`components/temo/command-deck.tsx` never called `crewCoordinator.init()` at all**. `app/chat/page.tsx` does (in an effect keyed on `useDashboardStore`'s `agents`), so voice only worked if `/chat` had been visited first in the same session (which happened to also populate `useDashboardStore`, masking the real gap — command-deck.tsx loads its own local `data.agents` from `agentRegistryService.loadAgents()` directly, entirely separate from the store).

**What changed** (`components/temo/command-deck.tsx`):
- New effect calls `useDashboardStore`'s `loadAgents()` action (the same store `app/chat/page.tsx` already populates) so the shared store has real agent data regardless of which page loads first.
- New effect calls `crewCoordinator.init(dashboardAgents)` (mirroring `app/chat/page.tsx`'s identical effect) whenever the store's `agents` change — this is the actual fix; without it the store fix alone would not have been sufficient.

**Live verification performed** (not typecheck-only): a fresh Playwright browser context navigated **directly to `/dashboard`** (no prior page visit), with the browser's `SpeechRecognition` API mocked to fire a real final transcript (the mock only replaces the mic-input layer — everything downstream, including the real AI provider calls, runs unmodified) — the voice trigger was clicked, and console logs confirm the full real pipeline completed: routing succeeded, a real Groq response was generated (310 chars), and TTS `speak()` began — zero "No agent selected" errors, across two separate runs. Main Dashboard's existing agent-list rendering (org chart, Corporate Office bands) confirmed unchanged via screenshot. `npm run typecheck` clean.

## M3-08 — INVESTIGATE THE MISSION THAT STALLED AT 20% (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-08. Branch: `milestone-3b-voice-fixes`.

**Root cause, confirmed against the actual database state for the real stalled mission** (`0fc7599a-2d60-4bdd-accd-b54706dcb095`, "hello timo create a workflow for managing social media...", created via voice from Main Dashboard) — this is scenario (a) from the ticket, traced to a specific mechanism:

- `mission_tasks` for this mission: 1 task `completed`, 1 task `running` with two logged `execution_failed` entries (`"Attempt 1/4 failed: Task timed out after 30000ms"`, `"Attempt 2/4 failed: Task timed out after 30000ms"`), and no further log entries after that — the in-process retry loop (`lib/swarm/executionLayer.ts`, up to `maxRetries + 1` attempts with exponential backoff between them) never reached attempts 3/4, and the task was never marked `'failed'`. The remaining 3 tasks sat in `'ready'`, correctly waiting their turn.
- Missions execute **synchronously inside the browser tab that triggered them** (`lib/swarm/unifiedOrchestrator.ts`'s `runMissionPipeline()` → `executionLayer.ts`'s per-task retry loop, all in-process JS). If that tab closes, navigates away, or the connection otherwise drops mid-retry-loop (between the two logged attempts, waiting on the backoff `setTimeout`), execution is silently abandoned — nothing server-side is watching it.
- A recovery mechanism for exactly this **already exists** at the database level: `claim_ready_tasks()` (`supabase/migrations/20260822100000_fix_stale_running_task_recovery.sql`) resets any task stuck `'running'` for more than 10 minutes back to `'ready'` before claiming new work. But nothing calls this function without a `pg_cron` schedule, and that schedule was never activated — it needs a stable deployed HTTPS URL for Supabase's Postgres to reach (`docs/TEMO-ARCHITECTURE.md`'s "PARTIAL (V1)" task-queue entry), unreachable from local dev. So the reset logic is real and correct, but dormant in this environment.
- This is **not** M3-01's health-skip logic (`isSkippableUnhealthy()`) — that only affects `chatWithFallback()`'s provider selection *before* a call is attempted; it never suppresses or swallows a task-level failure, and the execution log shows two genuine 30-second upstream timeouts, not a silent skip.

**What changed** (`app/missions/[id]/page.tsx`, UI-only per the ticket's scope for scenario (a) — the actual scheduler activation requires a deployed URL and is not implementable from local dev):
- New `isTaskStalled()` helper flags a task `'running'` for more than 10 minutes (matching `claim_ready_tasks()`'s own threshold, so the message is accurate about when the DB-level reset *would* apply if the scheduler were active).
- Mission detail page now shows an explicit amber banner when any task is stalled: *"A task hasn't progressed in over 10 minutes — still in progress, waiting on task processing. This environment has no automatic background scheduler active, so an interrupted task won't resume on its own; it will need to be reprocessed manually or the mission restarted."* — honest about the real limitation, never a fabricated "complete," never silent.
- Each stalled task also gets an inline "Stalled" badge next to its status in the task list.

**Live verification performed**: loaded the mission detail page for the actual real stalled mission from the database (not a synthetic test) — the banner and per-task badge render correctly, matching the real `running`/`ready` task states confirmed via direct database inspection. `npm run typecheck` clean.

## M3-09 — REMOVE THE OLD FLOATING VOICE CONTROL FROM ALL REMAINING PAGES (2026-08-26)

**Ticket**: `docs/BACKLOG-M3.md` M3-09. Branch: `milestone-3b-voice-fixes`.

**Decision**: option 1 from the ticket — no voice entry point at all on pages without a dedicated, purpose-built control. `components/layout/voice-hud.tsx` (the old icon-only, unlabeled-sub-buttons popover — `Chat`/`Mute`/`Mic`/`Stop`/`Voice`/`Settings`, distinguishable only by `aria-label`) was rendered globally by `TopNav` (used by every `AppShell`-wrapped page — Chat, Missions, Agents, Workflows, Knowledge, Memory, Tools, Analytics, Notifications, Settings — via `isDashboard`-based suppression that only ever covered `/` and `/dashboard`). Rather than building a third minimal-trigger variant for the remaining pages, voice is now scoped to exactly the two places that already have a real, purpose-built control: Main Dashboard's `VoiceTrigger` (M3-05) and Chat's mic button next to Send (fixed in M3-05, `M3-10` gives it visual parity). Pages with no voice control of their own simply have none — consistent with "voice is a Main-Dashboard/Chat feature," not scattered everywhere in a degraded form.

**What changed**:
- `components/temo/top-nav.tsx`: removed the `VoiceHud` import and its conditional render entirely (was `{!isDashboard && <VoiceHud />}`) — along with the now-unused `pathname`/`isDashboard`/`usePathname` import. `TopNav`'s status readout (`missionStatus` text — `LISTENING`/`PROCESSING`/`SPEAKING`/`TEMO ONLINE`, driven by the same shared `useVoiceStore`) is unchanged and still shows app-wide, since it's a status display, not a control.
- `components/layout/voice-hud.tsx` deleted — fully orphaned once its only render site was removed (confirmed via repo-wide search before deleting, per CLAUDE.md's "if you're certain something is unused, delete it completely").

**Live verification performed**: visited all 12 real routes (`/`, `/dashboard`, `/chat`, `/missions`, `/agents`, `/workflows`, `/knowledge`, `/memory`, `/tools`, `/analytics`, `/notifications`, `/settings`) via Playwright and confirmed zero occurrences of the old control's "Tap to speak"/"Listening…" text on any of them. `npm run typecheck` clean (no dangling import after the file deletion).

## M3-10 — BRING CHAT PAGE'S VOICE MIC TO VISUAL PARITY WITH MAIN DASHBOARD (2026-08-27)

**Ticket**: `docs/BACKLOG-M3.md` M3-10. Branch: `milestone-3b-voice-fixes`.

**What changed**:
- `components/temo/voice-trigger.tsx` — the inline `VoiceTrigger` implementation from M3-05 (previously private to `command-deck.tsx`) extracted into a standalone, reusable component, parameterized (`size`, `expandedWidth`, `anchorClassName`) so both pages can use the identical listening/thinking/speaking waveform and status UI instead of two independently-built versions. Also gained an optional `hideIdleTrigger` prop for callers (like Chat) that already have their own mic button and only want this component's active-state recording-bar/error feedback, not a second idle circle.
- `stores/voiceStore.ts` — new `lastError: string | null` field + `setError()` action, cleared automatically on the next `startListening()` (not on generic `reset()`, so an error stays visible after the interaction ends rather than disappearing instantly).
- `lib/voice/voice-manager.ts` — every real voice-flow failure now calls `store.setError()` in addition to its existing `logger.*` call: recognition errors (mic permission denied, generic recognition errors), an empty/no-speech transcript, and the `orchestrate()` catch block (previously that catch only reached the chat page via `replyHandler`, which Main Dashboard never wired — a failure there was completely invisible before this change).
- `app/chat/page.tsx` — the quick-prompts row is replaced by the shared `VoiceTrigger` (in `hideIdleTrigger` mode) whenever voice is active or has just errored, giving Chat the identical waveform/status/error feedback Main Dashboard has. `InputBar`'s own mic button (next to Send) remains the actual click target, unchanged from M3-05 — this only adds the missing visual feedback layer on top.
- `components/temo/command-deck.tsx` — its own inline copy removed; now imports the shared component (identical rendering, zero behavior change for Main Dashboard).

**Live verification performed** (not typecheck-only, browser `SpeechRecognition` mocked to fire real transcripts/errors while everything downstream — the real AI provider calls — runs unmodified): on `/chat`, a spoken question shows the recording bar with live waveform and transcript text, then a real 7-continents answer streams in — confirmed identical visual language to Main Dashboard via screenshot. Denying microphone permission (mocked `not-allowed` recognition error) produces a real, visible red error banner — *"Microphone access denied — allow microphone permission and try again."* — on both `/chat` and `/dashboard`, confirming the shared error path works everywhere `VoiceTrigger` is used. `npm run typecheck` clean.

## M3-11 — FIX SETTINGS → VOICE PAGE TO REFLECT THE REAL ENGINE (2026-08-27)

**Ticket**: `docs/BACKLOG-M3.md` M3-11. Branch: `milestone-3b-voice-fixes`.

**Findings**: the "Engine: Gemini Live API" field was exactly as fabricated as the ticket described (a hardcoded string, `onChange={() => {}}` — a genuine no-op). The Voice dropdown, however, was **already** real (`voiceManager.getAvailableVoices()`, live browser `speechSynthesis.getVoices()`) — the ticket's "Microsoft David" example was itself a real Windows voice name, not a fabricated one. The genuinely broken piece, found by tracing the real call chain: `lib/voice/voice-manager.ts`'s `speak()` resolved `voiceName`/`lang`/`rate`/`pitch` from the **active agent's** voice config first, falling back to `store.settings.*` only if the agent had none — and every real DB-backed agent (`agentRecordToRuntimeAgent()` in `lib/agents/agentRegistryService.ts`) carries the *identical* placeholder config (`{ voiceName: 'Default', lang: 'en-US', rate: 1.0, pitch: 1.0 }`) for every agent, with no real per-agent differentiation implemented. Since `'Default'` is a non-empty string, it always won — the user's Settings → Voice selection had **zero effect** on any real interaction, confirmed live: selecting a distinct voice and speaking through a real chat interaction still used whatever the placeholder resolved to, not the selection.

**What changed**:
- `app/settings/page.tsx`: Engine field now reads "Web Speech API (Browser)" — the real, single, honest option — instead of the fabricated "Gemini Live API". Added a "Test" button next to the Voice dropdown that calls `voiceManager.speak()` with a short sample using the currently-selected voice/speed/pitch live.
- `lib/voice/voice-manager.ts`'s `speak()`: now uses `store.settings.*` directly and unconditionally — the user's explicit Settings choice always applies. The now-dead `getActiveAgent()` private method and its unused `Agent` type import were removed (no other caller existed).

**Live verification performed** (not typecheck-only): confirmed the Voice dropdown lists 4 real distinct Windows voices (`Microsoft David`, `Hoda`, `Mark`, `Zira`); switching the selection and clicking Test genuinely changes which voice `speechSynthesis.speak()` invokes (verified by intercepting the real `speechSynthesis.speak` call in-browser). End-to-end: selected "Microsoft Hoda - Arabic (Egypt)" in Settings, navigated client-side to `/chat` (same session, same shared `useVoiceStore` instance), triggered a real voice interaction — the actual `speak()` call for the AI's real response used the exact voice selected in Settings, confirmed via the intercepted `speechSynthesis.speak()` call and the app's own `[voice] Speaking: ... {voice: Microsoft Hoda - Arabic (Egypt)}` log line. `npm run typecheck` clean.

## ARCHITECTURE DOCUMENT VERSION
Version: 3.16
Date: 2026-08-27
Status: Milestone 1 and Milestone 2 complete and merged to `main`. Milestone 3 (Speed & Stability + Visual/UX fixes): M3-01/02/04/05 merged to `main`. Completion pass underway on `milestone-3b-voice-fixes`: **M3-07 through M3-11 all done and live-verified.** M3-07: command-deck.tsx now populates the shared agent store and initializes `CrewCoordinator`'s registry, fixing "No agent selected" when Main Dashboard is the first page visited in a session. M3-08: root-caused the 20%-stalled mission to the client-side mission-execution model (no server-side scheduler active in this environment to resume an abandoned in-flight task) — a real recovery function already exists at the DB level but is dormant without a deployed `pg_cron` target; the mission detail page now surfaces an honest "stalled, waiting on task processing" state instead of silence. M3-09: removed the old icon-only VoiceHud popover everywhere (deleted the now-orphaned component) — voice is now exactly Main Dashboard's `VoiceTrigger` and Chat's own mic, nowhere else. M3-10: extracted `VoiceTrigger` into a shared component so Chat and Main Dashboard show identical listening/thinking/speaking feedback, and added a real visible error state (recognition failure, empty transcript, AI call failure) to the shared voice store instead of silent console-only logging. M3-11: fixed the fabricated "Gemini Live API" engine label, added a real voice test/preview button, and fixed a genuine bug where every real agent's identical placeholder voice config silently overrode the user's actual Settings → Voice selection on every interaction. Only M3-03 (G-Brain radial layout) and M3-06 (Timo persona pass) remain, both previously-queued tickets never yet started. Predecessor milestones: the Dynamic Model Router (`lib/ai/router/`, 2026-08-20) sits between every real AI call site and `chatWithFallback`/`streamWithFallback` — see the "DYNAMIC MODEL ROUTER" section above for full detail. Full prior-version history remains in the dated sections above this footer, in order.

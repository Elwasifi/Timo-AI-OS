# Milestone 1 — Reliability & Safety Backlog

> **CLOSED 2026-08-26 — all 9 tickets reviewed, approved, and merged to `main`.** Milestone 2 backlog (`docs/BACKLOG-M2.md`) is seeded with the two items this milestone's review surfaced (`M2-01`, `M2-02`); the full Milestone 2 scope will follow separately from Claude Cowork.
> Owner: Claude Cowork (Technical Manager). Implemented by: Claude Code (local). Status values: `Open` → `In Progress` → `Pushed for Review` → `Reviewed — ready to merge` → `Merged`.
> Goal of this milestone: TEMO can be trusted to (a) actually do what it says it did, (b) never bankrupt its owner, (c) hold a conversation across a page refresh, and (d) actually execute tools inside a multi-step mission — before any beta user (even a friendly one) touches it.

---

## M1-01 — Wire the Tool Executor into the Mission Engine
**Priority:** Critical (blocks the core product promise)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-01" section for the full change/verification trace.

**Problem:** `lib/swarm/executionLayer.ts`'s `executeTask()` only calls the LLM directly. It never invokes `lib/tools/executor.ts`. Missions (multi-step, delegated work) cannot use any tool, including n8n — only the synchronous chat path can.

**Acceptance criteria:**
- A mission task whose manager/worker determines a tool is needed (e.g. "run the daily report workflow") actually calls the real tool executor, respecting `requiresApproval` and `isSimulation`, exactly as the chat path already does via `decideTools()`.
- Retry/timeout semantics for a tool-calling task match the existing task retry logic — a failed tool call is a failed task, not silently swallowed.
- Timeline events record tool invocation and result, same pattern as existing `mission_timeline` events.
- Live-verified: a real mission that requires a real tool call (n8n trigger) completes with the tool actually invoked — not just typechecked.
- `docs/TEMO-ARCHITECTURE.md` Section 12 status table row for "Tool execution inside missions" updated from the current honestly-stated gap to `WORKING`, with a dated section describing what changed.

---

## M1-02 — Budget hard-gate before spend
**Priority:** Critical (financial risk)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. **Decision (2026-08-26)**: the $50/month internal-tenant placeholder ceiling stays as-is — reasonable while every provider is free-tier. It is provisional, not final; see `docs/TEMO-ARCHITECTURE.md`'s dated "M1-decisions" section for when it needs revisiting.

**Problem:** `checkBudget()` exists and is queryable but nothing calls it before an AI call. A bug or heavy usage has no ceiling.

**Acceptance criteria:**
- `chatWithFallback()` (or the nearest safe choke point that doesn't require rewriting every call site) checks the calling tenant's budget before making a paid provider call, and returns a clear `budget_exceeded` result instead of proceeding when the tenant is over its `monthly_limit_usd`.
- Ollama (self-hosted, zero marginal cost) calls are exempt — matches the existing `cost: 0, isEstimated: false` treatment in `lib/ai/pricing.ts`.
- The internal tenant (Amro's own operation) gets a configurable ceiling too — not unlimited by default, even though it's "internal."
- Live-verified: an artificially low budget on a test tenant actually blocks a subsequent call, with a clear user-facing message (not a silent failure or a generic error).

---

## M1-03 — Rate limiting on public API routes
**Priority:** Critical (abuse/cost risk, prerequisite for any external user)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-03" section. **Real gap flagged during review, tracked as `M2-02`**: the 2 rate-limited routes are the only *API* surface that can trigger spend, but the primary chat/mission path calls `orchestrate()` directly from `app/chat/page.tsx` (client-side, never through an API route at all) — meaning the actual highest-volume path has no rate limiting whatsoever today.

**Acceptance criteria:**
- Every route under `app/api/**` that can trigger an AI call or a tool execution has a per-tenant and per-IP rate limit (a simple token-bucket in Postgres or Supabase is enough for V1 — no new infrastructure dependency required).
- Exceeding the limit returns a standard `429` via the existing `lib/api/response.ts` envelope, not a crash.
- `docs/TEMO-ARCHITECTURE.md`'s existing "Security middleware interfaces" placeholder note is updated to reflect this is now real, not just an interface.

---

## M1-04 — Real n8n execution verification (no more fake success)
**Priority:** Critical (trust)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-04" section. Also fixed two more real bugs found while verifying: a workflow-name parsing bug and a wrong execution-ID field name that was silently breaking the Workflows page's execution list.

**Problem:** `lib/crew/n8n-action-handler.ts`'s `handleRun()` reports `success` based on the trigger's HTTP status only — it never confirms the workflow actually finished.

**Acceptance criteria:**
- After triggering a workflow, the handler polls `n8n.executions.get(executionId)` (or receives a webhook completion callback, if that's a cleaner fit for the existing `webhookService.ts`) until the execution reaches a terminal state, within a bounded timeout.
- `success: true` is only returned when the execution's real terminal status is success. A timeout or failure returns a clear "I couldn't confirm it finished — check n8n directly" message, never a false "Done."
- This is the direct fix for the exact code-level issue found during the architecture review (see the chat history / `docs/TEMO-ARCHITECTURE.md` if referenced there).

---

## M1-05 — Chat conversation persistence
**Priority:** High (first-impression UX)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-05" section.

**Problem:** `app/chat/page.tsx` has no `conversationId` handling — no `localStorage`, no DB-backed load-on-mount. A refresh loses the conversation.

**Acceptance criteria:**
- On chat page load, an existing open conversation (per authenticated tenant/user) is loaded from `conversations`/`messages`, not started fresh.
- A new conversation gets a persistent ID immediately, stored client-side (not just in memory), surviving a refresh.
- Existing `lib/ai/conversation-service.ts` (already DB-backed per the architecture doc) is reused — no new persistence layer.

---

## M1-06 — `requireUser()` audit on remaining API routes
**Priority:** High (security)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-06" section for the full classification table. **Decision (2026-08-26)**: the 16 globally-scoped routes stay as-is for now — the only real user of this system today is the internal tenant, so a global ops view is acceptable *temporarily*. This is explicitly not a permanent answer: it must be closed before even one external beta user is invited. Tracked as `M2-01`, marked Blocking for any beta invite.

**Problem:** Per `docs/TEMO-ARCHITECTURE.md`, only the 4 agent-registry mutating routes got explicit `requireUser()` hardening during the V1 auth pass. Every other route touching tenant-scoped or sensitive data needs the same audit, since the shared Supabase client resolves to the service-role key server-side (RLS is not a backstop there).

**Acceptance criteria:**
- Every route under `app/api/**` is classified: public/read-only-safe, or tenant-scoped-needs-`requireUser()`.
- Every route in the second category calls `requireUser()` and scopes its query to the caller's tenant.
- A short table of routes and their classification is added to `docs/TEMO-ARCHITECTURE.md`.

---

## M1-07 — Minimum viable automated test coverage
**Priority:** High (regression risk as scope grows)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-07" section. `npm test` runs 9 real integration tests (Vitest) against the live Supabase project — tenant isolation, the auth gate, mission lifecycle rollup.

**Acceptance criteria:**
- A test runner is added (Vitest is the lowest-friction choice for a Next.js/TypeScript project already using this stack — but Claude Code should confirm against current `package.json` before deciding).
- Coverage starts narrow and critical, not broad: tenant isolation (a query from tenant A never returns tenant B's data), the auth gate, and the mission lifecycle happy path. This is deliberately not "100% coverage" — it's the smallest set that catches the regressions that would actually hurt.
- `npm test` is added to `package.json` and documented in `CLAUDE.md`'s "Run available tests" line, which currently says none exist.

---

## M1-08 — Local n8n + cloudflared dev runbook (documentation only)
**Priority:** Medium (process risk — tribal knowledge)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. **Decision (2026-08-26)**: switch to a named Cloudflare tunnel — the stable URL avoids repeated reconfiguration friction on every restart. `docs/runbooks/local-n8n-dev-setup.md` updated with the named-tunnel setup procedure. **Not yet executed**: creating the actual named tunnel requires `cloudflared tunnel login` — an interactive browser OAuth flow against Amro's own Cloudflare account, which Claude Code cannot perform. The current quick tunnel remains the live configuration in `app_settings.n8n_url` until Amro runs that one step, after which the remaining `cloudflared tunnel create`/DNS route steps can be completed.

**Acceptance criteria:**
- `docs/runbooks/local-n8n-dev-setup.md` written, covering: the Docker command(s) used to run n8n locally, the `cloudflared tunnel --url http://localhost:5678` command and what URL/credential that produces, where that URL gets configured in TEMO's settings (`n8n-proxy` edge function config / `app_settings`), and what to do when the tunnel URL changes (cloudflared quick tunnels are not stable across restarts unless a named tunnel is used — worth deciding now whether to move to a named tunnel to stop the URL changing every restart).
- No code changes — this ticket exists purely so the dev environment isn't only in Amro's head.

---

## M1-09 — Internal Operator Mode design + first capability
**Priority:** Medium (needed before Amro starts delegating his own infra to TEMO)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M1-09" section. First capability (`operator.n8n.createWorkflowFromDescription`) proven structurally impossible for a client tenant even after a mistaken approval — not just policy. This was the final ticket of Milestone 1.

**Acceptance criteria:**
- Confirm/document that operator-mode capabilities are scoped to the internal tenant (`00000000-0000-0000-0000-000000000001`) only, per `docs/GOVERNANCE.md` Section 4.
- Pick one narrow first capability (e.g. "create an n8n workflow from a description") and implement it fully gated behind `requiresApproval: true` + `lib/governance/approvals.ts`, as a template for every future operator capability — not a broad "give TEMO my API keys" implementation.
- Explicitly do **not** reuse any operator-mode code path for client tenants — this should be structurally impossible, not just policy.

---

## Sequencing note

M1-01 through M1-04 are the ones that block calling the product "reliable" at all, per the earlier strategic review, and should be done first and roughly in that order (tool execution unblocks the core promise; budget/rate-limit protect against real financial risk; n8n verification fixes the trust-breaking bug). M1-05 through M1-09 can proceed in parallel once the first four are underway, since none of them depend on each other.

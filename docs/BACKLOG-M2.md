# Milestone 2 — Beta Readiness Backlog

> **CLOSED 2026-08-26 — both M2-01 and M2-02 reviewed, approved, and merged to `main`.**
> Owner: Claude Cowork (Technical Manager). Implemented by: Claude Code (local). Status values: `Open` → `In Progress` → `Pushed for Review` → `Reviewed — ready to merge` → `Merged`.
> M2-03 (named Cloudflare tunnel cutover) remains an owner action, not something Claude Code implements — still pending Amro's `cloudflared tunnel login` (see `docs/runbooks/local-n8n-dev-setup.md`).
>
> **Known open follow-ups, documented but not blocking, tracked for a future milestone (do not start):**
> - True per-tenant rate limiting + moving M1-02's budget gate into the `ai-chat` edge function itself (both flagged during M2-02 — see its section in `docs/TEMO-ARCHITECTURE.md`).
> - Agent display-name/avatar customization by the end user (role/skills stay locked) — a real product feature, not urgent.

---

## M2-01 — Tenant-scope the 16 globally-scoped API routes
**Priority:** Blocking (must close before any external beta user, even one)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M2-01" section for the full per-route table, plus the same-day "M2-01-fix" note (closed a multi-tenant-membership fallback gap the review caught before merge — see `docs/TEMO-ARCHITECTURE.md` for the full trace).

**Problem:** M1-06's audit (`docs/TEMO-ARCHITECTURE.md`'s dated "M1-06" section) found 16 `app/api/**` routes that call `requireUser()` (so *some* auth is present) but return global/aggregate data with no tenant filtering anywhere in the underlying service functions (`lib/dashboard/dashboardService.ts`, `lib/dashboard/healthService.ts`, `lib/swarm/runtimeStore.ts`, `lib/agents/agentRegistryService.ts`): `missions/summary`, `runtime/activity`, `runtime/health`, `runtime/state`, `stats/dashboard`, `stats/knowledge`, `stats/memory`, `stats/providers`, `stats/tools`, `stats/workflows`, `tasks/active`, `tasks/queue` (no-`missionId` case), `agents/departments`, `agents/managers`, `agents/registry`, `agents/registry/[id]`.

**Decision made (2026-08-26, during M1 review)**: acceptable to leave as-is *temporarily*, since the internal tenant is currently the only real user of the system. **Explicitly not a permanent answer** — this must be closed before any external beta user is invited, even a friendly one.

**Acceptance criteria** (draft — confirm/refine with Claude Cowork before implementing):
- Each of the 16 routes either gets real tenant filtering added at the service-function layer (if it's meant to show a tenant only its own missions/tasks/usage), or is explicitly and permanently documented as intentionally global/shared (matching the agent registry's already-documented global-by-design model) — no route should remain in an undecided middle state.
- Live-verified with a real two-tenant test per route that gets scoped (same pattern used throughout Milestone 1: a throwaway second tenant must not see the internal tenant's data).
- `docs/TEMO-ARCHITECTURE.md`'s M1-06 classification table updated to reflect the final state.

---

## M2-02 — Rate limiting on the primary chat/mission path
**Priority:** High (abuse/cost risk — this is the actual highest-volume path)
**Status:** Merged — reviewed and approved by Claude Cowork; merged to `main` 2026-08-26. See `docs/TEMO-ARCHITECTURE.md`'s dated "M2-02" section for the full architectural decision writeup. Fixed via a per-IP gate inside the `ai-chat` edge function itself — genuinely unbypassable, no changes needed to any existing caller. **Open follow-up, not implemented, tracked for a future milestone**: true per-tenant rate limiting, and moving M1-02's budget gate into the edge function too (both flagged during this ticket — would require threading real tenant identity through 3 internal AI call sites that don't carry it today: `lib/tools/planner.ts`, `lib/memory/summarizer.ts`, `lib/crew/ai-intent-analyzer.ts`).

**Problem:** M1-03 added rate limiting to the 2 `app/api/**` routes that can trigger an AI call or tool execution (`tasks/process`, `settings/validate-provider`). But the primary chat/mission path (`orchestrate()`) is called directly from `app/chat/page.tsx` — **client-side, never through an API route at all** — so it has no rate limiting whatsoever. This is the path a real user actually spams if they're abusing the product, and M1-03's protection doesn't touch it.

**Acceptance criteria** (draft — confirm/refine with Claude Cowork before implementing):
- Determine the right enforcement point given `orchestrate()` runs client-side: likely either (a) move the entry point server-side (a real architectural change, bigger scope), or (b) apply the same `check_rate_limit()` token-bucket (from M1-03, already real infrastructure) at a point `orchestrate()` itself can call before triggering AI/tool spend, keyed per-tenant/per-user. Needs a real design decision, not just bolting a check onto client code that a malicious client could bypass by calling the underlying functions directly — same trust-boundary problem M1-06 flagged for API routes applies here too.
- Exceeding the limit returns the same clear, non-crashing user-facing message pattern already established (`M1-02`'s budget-exceeded message, `M1-03`'s `429` envelope).
- Live-verified: a real burst of requests from one tenant/session gets throttled with a clear message, not silently allowed through or a raw error.

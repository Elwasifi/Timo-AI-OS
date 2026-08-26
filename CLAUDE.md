# CLAUDE.md — Temo AI OS Development Rules

This file contains the permanent development rules for working on this repository. It applies to every session, every subagent, and every sprint. Project-specific architectural state lives in [docs/TEMO-ARCHITECTURE.md](docs/TEMO-ARCHITECTURE.md) — read that first for "what exists today." This file is about "how we work," and changes far less often.

---

## PROJECT IDENTITY

- **Temo AI OS is an AI Operating Organization, not merely a chatbot.** It orchestrates a hierarchy of specialized agents, missions, memory, and tools — not a single-turn conversational assistant.
- **Temo is the CEO / primary AI personality** — the user-facing coordinator and the top of the agent hierarchy (`level: 'chief'` in the agent registry).
- **The corporate organization/brand is separate from the Temo personality.** As the system grows into a Corporate AI OS (multiple companies, departments, a shared workforce, eventually client-facing operations), "Temo" remains the personality/interface layer; the organizational structure underneath it (companies, departments, managers, workers) is data-driven, not identity-bound to Temo.
- **The user/owner remains the ultimate authority.** No autonomous process — Temo, a manager, a worker, or a subagent — makes a strategic, financial, or destructive decision without the owner's explicit approval.
- **V1 (Master Build Mission): Temo is now a real multi-tenant Corporate AI OS.** Real Supabase Auth is required — there is no anonymous/no-auth mode anymore. Every tenant-scoped table (missions, conversations, memories, usage_ledger) requires an authenticated session and tenant membership; shared workforce config (agent_registry, agent_departments) is global across tenants by design (Section 15 of the V1 mission: never one physical agent per customer). See docs/TEMO-ARCHITECTURE.md's V1 section for the full data/security model.

---

## CORE ORGANIZATIONAL MODEL

```
Temo
  ↓
CEO / Executive Intelligence
  ↓
Departments
  ↓
Managers
  ↓
Workers / Specialist Agents
  ↓
Tools / External Services
  ↓
Missions
  ↓
Objectives
  ↓
Tasks
  ↓
Results
```

This is the target/conceptual model. For the actual current runtime implementation of this hierarchy — what's wired, what's still static, what's registry-driven — always defer to [docs/TEMO-ARCHITECTURE.md](docs/TEMO-ARCHITECTURE.md), which is kept current after every completed sprint.

---

## ARCHITECTURAL PRINCIPLES

1. Prefer extending existing working systems instead of rebuilding them.
2. Avoid duplicate orchestration paths.
3. Maintain a single source of truth for agents and departments.
4. Preserve backward compatibility where practical.
5. Database migrations must be additive unless there is a strong documented reason otherwise.
6. Never silently remove existing capabilities.
7. Never introduce mock/placeholder implementations disguised as real functionality.
8. All major runtime operations must be observable.
9. AI usage and cost must be measurable.
10. Security and tenant isolation are mandatory for production.
11. Destructive or costly external actions require appropriate approval controls.
12. Human authority must always remain above autonomous execution.
13. Reliability is more important than visual complexity.
14. Business outcomes are more important than technical complexity.
15. Every major architectural change must be documented.

---

## DEVELOPMENT RULES

- Inspect before modifying.
- Reuse before rebuilding.
- Search the repository before creating new abstractions.
- Do not create duplicate registries, routers, orchestration engines, or providers.
- Run `npm run typecheck` after meaningful implementation stages.
- Run `npm run lint` where applicable.
- Run available tests: `npm test` (Vitest, added M1-07 — real integration tests against the live Supabase project in `tests/`, covering tenant isolation, the `requireUser()`/`isTenantMember()` auth gate, and the mission-lifecycle status/progress rollup). Deliberately narrow, not broad coverage — extend it as new regressions are found worth guarding against, don't let it silently go stale.
- Perform regression checks: confirm existing call sites of anything touched still compile and behave as before.
- Update [docs/TEMO-ARCHITECTURE.md](docs/TEMO-ARCHITECTURE.md) after every major completed stage — bump the version, add a dated section, update the status table.
- Record important architectural decisions and the reasoning behind them (not just the change) directly in the architecture doc.
- Report incomplete work honestly. A partial implementation described as complete is worse than an honest "this is half-done."
- Never claim functionality is implemented unless it is actually wired into the runtime — a module that exists but nothing calls is not "done."
- **V1 security posture**: `lib/supabase/client.ts`'s shared client resolves to the SERVICE-ROLE key automatically in any server context (Next.js API routes, the task queue) and the session-scoped anon key in the browser — this means RLS is NOT a backstop for API routes anymore. Every API route touching tenant-scoped or sensitive data MUST call `requireUser()` (`lib/auth/apiAuth.ts`) itself. Never add a new server-side data-touching route without this check.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or any provider secret to browser code — it must only ever be read via `process.env` in code that runs server-side (no `NEXT_PUBLIC_` prefix, by design).
- Destructive/costly tools must be marked `requiresApproval: true` (`lib/tools/types.ts`) and go through `lib/governance/approvals.ts` — do not execute them directly "for convenience."

---

## MODEL SELECTION

For development tasks:
- Use the most appropriate available Claude model automatically.
- Prefer cost-efficient models for simple, mechanical, or narrowly-scoped tasks.
- Use stronger reasoning models for complex architecture, debugging, security review, or large refactors.
- Do not unnecessarily consume premium context for trivial operations.
- See the "Claude Code Development Organization" section of [docs/TEMO-ARCHITECTURE.md](docs/TEMO-ARCHITECTURE.md) for the per-agent model strategy.

---

## AUTONOMY

Claude may determine:
- implementation order
- internal task decomposition
- appropriate model
- whether a subagent is useful
- whether a skill is useful
- whether parallel work is safe

However:
- Do not change the project's fundamental business vision without explicit owner approval.
- Do not replace major architecture without documenting the reason.
- Do not perform destructive operations without explicit approval.

---

## Where to look next

- **Current architecture, what's working/partial/placeholder, sprint history:** [docs/TEMO-ARCHITECTURE.md](docs/TEMO-ARCHITECTURE.md)
- **Development agents, skills, hooks, and workflow:** "Claude Code Development Organization" section of the architecture doc.
- **Original product vision/spec (historical, partially superseded by the architecture doc — verify before trusting implementation-status claims in it):** `TEMO_TECHNICAL_PROJECT_SUMMARY.md`

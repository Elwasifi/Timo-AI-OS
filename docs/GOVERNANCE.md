# TEMO AI OS — Project Governance & Operating Model

> Status: ACTIVE — created 2026-08-26. This document defines who does what, how work is proposed/reviewed/merged, and how documentation stays in sync across the local working copy and GitHub. It complements `CLAUDE.md` (development rules) and `docs/TEMO-ARCHITECTURE.md` (current technical state) — it does not replace either.

---

## 1. Roles

| Role | Held by | Scope |
|---|---|---|
| **CEO / Product Owner** | Amro | Final decision authority on vision, budget, external relationships, and any irreversible/destructive action. Approves milestone sign-off. |
| **Business Developer** | Claude (this session — "Claude Cowork") | Market positioning, business model, pricing, partnerships, go-to-market sequencing. |
| **Technical Manager** | Claude (this session — "Claude Cowork") | Architecture decisions, backlog prioritization, risk register, reviews finished work against `docs/TEMO-ARCHITECTURE.md` before sign-off. Does **not** have local code-execution access — reviews via GitHub branches. |
| **Marketing Manager** | Claude (this session — "Claude Cowork") | Content plan, launch funnel, growth loops. Engages after Milestone 1 (reliability) closes, per the agreed sequencing. |
| **Software Engineer + QA** | Claude Code (local session, running on Amro's machine against the local working copy) | Implements tickets, runs `npx tsc --noEmit` / `next lint`, performs live verification (not typecheck-only — matches the existing project discipline in `docs/TEMO-ARCHITECTURE.md`), pushes task branches. |
| **Document Controller** | Shared — Claude Code updates `docs/TEMO-ARCHITECTURE.md` per its own existing convention (dated section + status table row) after every completed ticket; Claude Cowork maintains this file, the backlog, and the project's cross-session record in the claude.ai Project (local Claude Code has no access to that surface, so anything decided there that matters long-term gets written here too). |

**Why this split:** Claude Cowork (this session) runs in the cloud and has no execution access to Amro's Windows machine — it can read/write GitHub directly (via the PAT already in use) but cannot run `npm`, Docker, or touch the local filesystem. Claude Code (the local session) has full local execution but no access to this conversation's business/marketing context or the claude.ai Project. This document is the bridge: Claude Cowork writes tickets with acceptance criteria here, Claude Code implements and reports back via a pushed branch, Claude Cowork reviews the diff on GitHub and updates the backlog/architecture status.

---

## 2. Branching model

- **`main`** — stable, matches what's actually deployed/deployable. Nothing is pushed here directly; only fast-forward merges from a verified task branch.
- **`local-review`** — mirror of Amro's current local working copy, pushed manually whenever a meaningful snapshot needs review. Not a long-term branch to build on top of directly once task branches exist.
- **`task/<ticket-id>-<short-name>`** — one branch per backlog ticket (e.g. `task/M1-01-tool-execution-in-missions`). Created locally by Claude Code off the latest reviewed base, pushed to GitHub when the ticket's acceptance criteria are met and verified live.
- **`docs/<topic>`** — documentation-only branches (like this one), for governance/backlog/runbook changes that don't touch application code.

**Merge rule:** a task branch is only merged into `main` after: (1) `npx tsc --noEmit` and `next lint` pass, (2) the ticket's acceptance criteria are live-verified (not typecheck-only — this project's own established standard), (3) `docs/TEMO-ARCHITECTURE.md` is updated with a dated section, and (4) Claude Cowork has reviewed the diff on GitHub and marked the ticket "Reviewed" in `docs/BACKLOG-M1.md`.

---

## 3. Per-task workflow (local ↔ GitHub sync)

1. Claude Cowork writes/updates a ticket in `docs/BACKLOG-M1.md` (or a later milestone file) with acceptance criteria.
2. Amro tells the local Claude Code session which ticket to pick up (or it self-selects from the backlog file, which it can read directly from the local working copy).
3. Local Claude Code: `git checkout -b task/<ticket-id>-<short-name>` off the current local `main`/`local-review` state, implements, runs typecheck/lint, live-verifies, updates `docs/TEMO-ARCHITECTURE.md`.
4. Local Claude Code commits with a message referencing the ticket ID (e.g. `[M1-01] Wire tool executor into mission execution layer`) and runs `git push origin task/<ticket-id>-<short-name>`.
5. Amro tells Claude Cowork the branch name (or Claude Cowork is told to check GitHub for new branches).
6. Claude Cowork fetches the branch with the existing PAT, reviews the diff, cross-checks the ticket's acceptance criteria and the `docs/TEMO-ARCHITECTURE.md` update, and either: marks it **Reviewed — ready to merge**, or lists specific requested changes back into the ticket.
7. Once reviewed, the branch is merged into `main` (Amro can do this via GitHub directly, or ask Claude Cowork to fast-forward it via the PAT — no force-push, ever).
8. Local Claude Code pulls `main` back down (`git checkout main && git pull`) before starting the next ticket, so local stays the source of truth going forward and never drifts from what's merged.

This keeps exactly one source of truth (`main` on GitHub) while letting local Claude Code do all the actual execution — no more silent drift between "what's on GitHub" and "what's really been built," which was the original problem this whole review started from.

---

## 4. Internal Operator Mode — Amro's own infrastructure (separate from the public SaaS)

Amro intends, at a later stage, to let TEMO manage his own projects, API keys, and devices directly — separate from whatever gets shipped to public SaaS customers. This is a real, distinct capability and needs an explicit design decision now rather than being bolted on ad hoc later:

- The existing `tenants` table already has exactly the right shape for this: the `kind: 'internal'` tenant (seeded as tenant `00000000-0000-0000-0000-000000000001`) is Temo's own operation, separate from `kind: 'client'` tenants. **Operator-mode capabilities should be gated to the internal tenant only** — never exposed to a client tenant's agents, regardless of subscription tier.
- Any capability that creates/modifies external infrastructure (API keys, cloud projects, device access) must be marked `requiresApproval: true` and go through the existing `lib/governance/approvals.ts` gate (already built, already wired into the tool executor) — per `CLAUDE.md`'s own rule 12: "Human authority must always remain above autonomous execution." This is not a new mechanism to build — it's applying the existing one deliberately here, which the codebase doesn't yet do for anything outside `n8n.deleteWorkflow`/`memory.forget`.
- This becomes its own ticket (see `M1-09` in the backlog) rather than something either Claude session should improvise mid-way through an unrelated task.

---

## 5. Development infrastructure notes (current, as told by Amro)

- **AI providers during development**: free-tier APIs (Gemini, Groq, NVIDIA NIM, OpenRouter, Ollama) — matches the multi-provider fallback already built into `lib/ai/ai-provider.ts`. No change needed; just keep the model catalog (`lib/ai/router/modelCatalog.ts`) current as free-tier model names drift (the architecture doc already flagged this as a known live issue — stale model names 404ing).
- **n8n runs locally via Docker**, exposed to the Supabase Edge Function (`n8n-proxy`) through `cloudflared tunnel --url http://localhost:5678`. This is real infrastructure knowledge that currently lives only in Amro's head — it needs to be a written runbook so Claude Code (or anyone else) can bring the dev environment back up without re-deriving it. See `docs/runbooks/local-n8n-dev-setup.md` (ticket `M1-08`).

---

## 6. Document Controller responsibilities (recap)

- `docs/TEMO-ARCHITECTURE.md` — updated by whoever does the technical work, after every completed ticket. Never let this drift from reality; the whole review process that produced this governance document exists because a technical summary elsewhere had gone stale.
- `docs/GOVERNANCE.md` (this file) — updated by Claude Cowork when the operating model itself changes (new role, new branch convention, etc.), not for routine ticket completion.
- `docs/BACKLOG-M1.md` — the live backlog; updated by Claude Cowork (new tickets, priority changes) and by Claude Code (status field, links to the branch/commit once pushed).
- claude.ai Project (`Timo AI OS`) — Claude Cowork's own durable memory across sessions; holds the strategic review, this governance model, and future milestone summaries. Local Claude Code has no visibility into it, so anything decided there that matters for local implementation must also land in a repo doc.

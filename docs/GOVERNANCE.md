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

**Revised 2026-08-26** (superseding the original per-ticket-branch draft below, per Amro's explicit preference): all of a milestone's work happens on a single long-lived milestone branch, checked out locally the entire time, so the local working copy and the GitHub branch are always the same tree. `main` is only touched once, at the end, when the whole milestone is verified.

- **`main`** — stable, matches what's actually deployed/deployable. Nothing is pushed here directly; only merged in from a fully-verified milestone branch.
- **`local-review`** — the original one-off snapshot branch used for the initial architecture review. No longer actively built on.
- **`milestone-1-reliability`** (current) — the active branch for the whole of Milestone 1 (`docs/BACKLOG-M1.md`, tickets M1-01 through M1-09). Checked out locally for the full duration of the milestone. **One commit per ticket** (message prefixed `[M1-0x]`), pushed to `origin/milestone-1-reliability` as soon as each ticket is done and live-verified — not batched to the end — so Claude Cowork can review incrementally even though the merge into `main` itself happens only once, after the last ticket. Future milestones follow the same pattern (`milestone-2-<name>`, etc.).
- **`docs/<topic>`** — documentation-only branches, for governance/backlog/runbook changes made outside an active milestone branch.

**Merge-to-main rule (end of milestone):** the milestone branch merges into `main` only after: (1) `npx tsc --noEmit` and `next lint` pass on the final state, (2) every ticket's acceptance criteria has been live-verified (not typecheck-only), (3) `docs/TEMO-ARCHITECTURE.md` carries a dated section per completed ticket, and (4) Claude Cowork has reviewed every pushed commit on the branch and marked all tickets "Reviewed" in `docs/BACKLOG-M1.md`.

<details><summary>Original per-ticket-branch model (superseded, kept for reference)</summary>

- **`task/<ticket-id>-<short-name>`** — one branch per backlog ticket (e.g. `task/M1-01-tool-execution-in-missions`), merged into `main` individually as each ticket completes. Replaced by the single-milestone-branch model above because it added review overhead without a corresponding safety benefit at this project's current scale.

</details>

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

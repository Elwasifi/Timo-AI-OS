---
name: architecture-governance
description: Decide whether a proposed change should extend an existing Temo AI OS module or genuinely justifies a new one, and check for duplicate-orchestration risk before writing code. Use before starting any new file, subsystem, registry, router, or provider abstraction. Triggers on "should this be a new file", "does this already exist", "where should this logic live", "am I about to duplicate something".
---

# Architecture Governance

Temo AI OS has one confirmed, expensive failure mode: a second orchestration/registry path growing up alongside the canonical one (`lib/crew` vs `lib/agents`/`lib/swarm`, unwound across a dedicated sprint). This skill is the checklist that prevents a repeat.

## Before writing a new file or abstraction

1. **Search first.** Grep for the concept you're about to build (a keyword from its purpose, not just a proposed filename) across `lib/`. If something already does 70% of this job, extend it — do not build a parallel version "to keep things clean." Read [docs/TEMO-ARCHITECTURE.md](../../../docs/TEMO-ARCHITECTURE.md) for the current map of what exists in `lib/agents`, `lib/crew`, `lib/swarm`, `lib/memory`, `lib/knowledge`, `lib/tools`, `lib/ai`.
2. **Identify the single source of truth.** For agents/departments, that's `lib/agents/agentRegistryService.ts` — nothing else should hold authoritative agent data, only caches synced from it (e.g. `lib/crew/agent-registry.ts` via `mergeFromRegistry`). For AI provider calls, that's `chatWithFallback`/`streamWithFallback` in `lib/ai/ai-provider.ts` — no other code should call a provider directly. Any new concept that needs a "single source of truth" property should be checked against this list, and added to it in the architecture doc if it's genuinely new.
3. **Prefer data-driven generalization over hardcoding.** If you're tempted to hardcode a name, id, or fixed list (a specific manager, a specific worker, a specific provider), check whether the equivalent registry/data-driven pattern already exists elsewhere in the project (it does, for delegation and for the agent hierarchy) and follow that shape instead.
4. **Minimum viable change.** State explicitly what the smallest change is that closes the actual gap, and why anything larger would be premature. A sprint that touches 2 files because that's all that was needed is a *good* outcome, not an incomplete one.
5. **If a new file is genuinely justified**, say explicitly why extending an existing one was wrong (file would become unrelated-concerns-mixed, or the existing module's responsibility genuinely doesn't cover this) — don't create it silently.

## After the change

Confirm no second version of an existing concept now exists. If in doubt, run this concrete check: for the concept you touched, list every file that could plausibly claim to be "the" implementation of it, and confirm there's exactly one, with everything else either consuming it or explicitly marked as a compatibility shim.

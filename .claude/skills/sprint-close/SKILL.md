---
name: sprint-close
description: Close out a completed Temo AI OS sprint/implementation stage using the exact verification-and-documentation protocol this project has used successfully across every prior sprint. Use when implementation work is done and needs to be verified and documented before being reported complete. Triggers on "close this sprint", "wrap up", "is this done", "finish this stage".
---

# Sprint Close

This is the mechanical closing procedure Temo AI OS sprints have followed. It exists so verification and documentation are never skipped or improvised under time pressure. Follow it in order.

## 1. Verify

- Run `npm run typecheck` (if `node_modules` is missing, run `npm install` first — this environment does not always have dependencies pre-installed). Must pass with zero errors before continuing.
- Run `npm run lint`. Compare against pre-existing warnings (this project has some known, pre-existing lint warnings in untouched legacy files — `app/chat/page.tsx`, `components/layout/command-palette.tsx`, `components/temo/chat-dock.tsx`, `components/temo/command-deck.tsx` as of the last check). The bar is **zero new issues**, not zero issues overall.
- Grep for every call site of anything whose signature or behavior changed. Confirm each one still compiles and makes sense.
- Grep for signs of an accidentally-introduced duplicate abstraction (a second registry, router, provider client, or similar). This project has a real history of this happening — treat the check as load-bearing, not a formality.
- If a database migration was written, confirm it is additive-only (no `DROP`/destructive `ALTER` against an existing table or column).
- No test framework currently exists in this project. Say so plainly rather than skipping the topic or inventing a substitute.

## 2. Document

Update `docs/TEMO-ARCHITECTURE.md`:
- Add a new dated subsection under the relevant area describing what changed, **why** (not just what), and how it fits what already existed.
- Update the "Current Status" table for any component whose status changed (WORKING / PARTIAL / PLACEHOLDER / MISSING / PLANNED).
- Update the "Current Runtime Limitations" section if anything was resolved or newly discovered.
- Bump the version number at the bottom of the document and update the `Status:` line to name the sprint/stage.
- Do not create a second architecture document. Everything goes into this one file.

## 3. Report

Produce a structured completion report covering (only what's applicable to the sprint in question):
1. Files modified/created
2. Database changes (or "none required" — say so explicitly)
3. What was implemented, in concrete terms tied to files
4. Verification performed and its actual results (not "looks fine" — state what passed)
5. Architecture document version after the update
6. Remaining limitations/known gaps, stated honestly
7. Anything explicitly out of scope that was correctly left undone

Do not report something as "implemented" unless it is actually wired into the runtime and reachable from a real call path — a module that exists in isolation is not done.

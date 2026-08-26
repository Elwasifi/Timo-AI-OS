---
name: db-migration-review
description: Write or review a Supabase/Postgres migration for Temo AI OS using this project's established conventions (additive-only, RLS pattern selection, ID type matching, header documentation style). Use whenever a new migration file is about to be written, or to review one that already exists. Triggers on "write a migration", "add a table/column", "review this migration", "is this RLS policy right".
---

# Database Migration Review

Temo AI OS's `supabase/migrations/` directory encodes real, consistent decisions across every migration so far. Match them — don't improvise a new style.

## Checklist for writing a new migration

1. **Additive only.** Never `DROP TABLE`, `DROP COLUMN`, or destructively `ALTER` an existing column's type/constraints in a way that could lose data. If something needs to change meaning, add a new column and document the transition plan in the header comment; don't silently repurpose an existing one.
2. **Header comment block** (`/* ... */`) at the top of every migration: state the purpose, list new tables/columns with their meaning, state the security/RLS model and why, and note anything a future reader needs to know (idempotency, seed data, relationship to other tables). Every existing migration in this project does this — new ones must too.
3. **RLS is enabled on every table**, but the policy set depends on the table's semantics — don't default to one pattern without thinking:
   - **Normal mutable data** (agents, departments, missions, memories): full CRUD granted to `anon, authenticated`, with an explicit comment noting this is because the project is currently single-tenant/no-auth and will be tightened when authentication ships.
   - **Append-only/audit data** (e.g. `usage_ledger`): define **only** SELECT and INSERT policies. Do not define UPDATE or DELETE policies — Postgres RLS denies both by default when no policy grants them, which enforces "never modify or delete historical records" at the database layer, not just by application convention.
4. **ID types must match what they reference**: `agent_registry`/`agent_departments` use `text` primary keys (stable slugs). `missions`/`mission_objectives`/`mission_tasks` use `uuid`. A new FK column's type must match the table it references — check the actual `CREATE TABLE` statement, don't assume.
5. **Enums vs. text**: use a Postgres enum only for a genuinely closed, rarely-changing set (see `agent_level`, `agent_availability`). Use plain `text` for anything expected to grow over time without a migration (provider ids, operation/event types) — a new value should never require a schema change.
6. **Indexes**: add one for every FK column and every column a service-layer query filters or sorts on. Use a partial index (`WHERE column IS NOT NULL`) for nullable FK columns that are usually null (e.g. `mission_id` on a table most rows don't belong to a mission).
7. **Idempotency where practical**: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, `ON CONFLICT (id) DO UPDATE` for seed data — this project's migrations are written to be safely re-runnable.
8. **Filename convention**: `YYYYMMDDHHMMSS_short_description.sql`, timestamped after the most recent existing migration.

## Before finalizing

State explicitly: "this migration is additive-only" (it should almost always be true), confirm every FK type matches its target table, and confirm the RLS policy set matches the table's actual read/write/append semantics rather than being copy-pasted from the last migration without thinking.

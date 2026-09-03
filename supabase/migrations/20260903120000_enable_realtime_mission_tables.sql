-- M7-02: Supabase Realtime replacing fixed-interval polling for the
-- G-Brain active-mission indicator and the mission detail page's
-- Objectives/Timeline/Tasks panels.
--
-- Realtime's `postgres_changes` feature only delivers change events for
-- tables explicitly added to the `supabase_realtime` publication — no
-- table in this project has ever been added to it (confirmed by
-- repo-wide search of supabase/migrations for "supabase_realtime" /
-- "ALTER PUBLICATION" before writing this migration: zero prior matches).
-- Without this migration, the new client-side Realtime subscriptions in
-- app/missions/[id]/page.tsx and components/temo/org-chart.tsx will
-- subscribe successfully but never receive an event — the UI would look
-- correct in code but silently never live-update in production. Additive
-- only: adds tables to a publication, does not alter any table's schema,
-- data, or RLS policies. Idempotent — safe to re-run (ADD TABLE is a
-- no-op, not an error, when the table is already a publication member,
-- since PostgreSQL 15; this project's migrations already assume a
-- version at least that recent).
--
-- REPLICA IDENTITY is left at its default (primary key only) for all four
-- tables: the consuming code only uses the change event as a signal to
-- refetch the full row via the existing authenticated REST path, it never
-- reads the old/new row payload off the Realtime event itself, so FULL
-- replica identity (needed only to see pre-update column values) is not
-- required here.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'missions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.missions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mission_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_tasks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mission_objectives'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_objectives;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mission_timeline'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_timeline;
  END IF;
END $$;

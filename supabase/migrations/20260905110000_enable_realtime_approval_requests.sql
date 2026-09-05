-- M7-04: the new in-context inline approval banner
-- (components/temo/approval-banner.tsx) subscribes to approval_requests
-- via Supabase Realtime (same mechanism M7-02 wired up for
-- missions/mission_tasks/mission_objectives/mission_timeline) so a pending
-- approval appears the moment it's created, without polling. That
-- migration did not include approval_requests — it wasn't needed until
-- this ticket. Adds it now, same additive/idempotent pattern.
--
-- Same RLS/DELETE-bypass consideration already reviewed and documented for
-- M7-02 (docs/TEMO-ARCHITECTURE.md) applies here: INSERT/UPDATE events are
-- RLS-filtered per subscriber automatically; approval_requests has no
-- authenticated-role DELETE policy (confirmed via
-- 20260819140000_create_v1_corporate_os_foundation.sql), so the DELETE-
-- bypasses-RLS gap is the same dormant, unreachable-from-the-app
-- non-issue it was there.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'approval_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_requests;
  END IF;
END $$;

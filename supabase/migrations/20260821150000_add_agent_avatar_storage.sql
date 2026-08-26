/*
# Agent avatar image support (UI integration pass)

Adds a real, persisted, DB-referenced image for an agent — distinct from the
existing `avatar` column, which is a Lucide icon *name* (see
20260727225714_create_agent_registry_foundation.sql's own comment: "Lucide
icon name for the agent"), not an image. Before this migration there was no
image/URL column on agent_registry and no Supabase Storage bucket anywhere
in this project (confirmed by exhaustive grep during the UI audit) — every
agent portrait rendered today comes from a hardcoded id->filepath map in
lib/agents/frontendBridge.ts, which cannot represent a newly-created agent's
image at all.

Additive only: new nullable column, new bucket, new storage policies. No
existing table dropped/recreated, no existing agent row touched (avatar_url
defaults to NULL, and every render path already falls back to the existing
icon system when it's unset).
*/

ALTER TABLE agent_registry
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Public bucket: agent portraits are already served as public static
-- assets today (lib/agents/frontendBridge.ts's HOLO_IMAGES under /public),
-- so a public read bucket matches existing exposure, not a new one.
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-avatars', 'agent-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "agent_avatars_public_read" ON storage.objects;
CREATE POLICY "agent_avatars_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'agent-avatars');

-- Writes require a signed-in session — matches agent_registry's own
-- authenticated-only write policy (20260727225714 lines ~139-160), so
-- uploading a new avatar requires the same access level as editing the
-- agent record it gets attached to.
DROP POLICY IF EXISTS "agent_avatars_authenticated_write" ON storage.objects;
CREATE POLICY "agent_avatars_authenticated_write" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'agent-avatars');
DROP POLICY IF EXISTS "agent_avatars_authenticated_update" ON storage.objects;
CREATE POLICY "agent_avatars_authenticated_update" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'agent-avatars') WITH CHECK (bucket_id = 'agent-avatars');
DROP POLICY IF EXISTS "agent_avatars_authenticated_delete" ON storage.objects;
CREATE POLICY "agent_avatars_authenticated_delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'agent-avatars');

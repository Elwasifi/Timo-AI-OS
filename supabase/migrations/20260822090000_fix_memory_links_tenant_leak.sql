-- Fix memory_links cross-tenant RLS leak.
--
-- Migration 20260819140000 lumped memory_links into its "shared/global
-- system tables" DO block (Section 10) alongside agent_registry/runtime_state
-- — genuinely global-by-design tables (Section 15: shared workforce config).
-- memory_links is not one of those: it links two rows of the tenant-scoped
-- `memories` table (no tenant_id of its own, same shape as memory_embeddings,
-- which the SAME migration correctly scopes via a subquery through
-- memories.tenant_id just 15 lines earlier). The result: any authenticated
-- user, from any tenant, could read every tenant's memory link graph and
-- write links against any tenant's real memory IDs. The only currently-live
-- caller is a service-role row count (lib/memory/memoryService.ts getStats(),
-- which bypasses RLS entirely) — no legitimate authenticated caller depends
-- on the broad policy, so tightening to match memory_embeddings' pattern is
-- safe.

DROP POLICY IF EXISTS "memory_links_authenticated_select" ON memory_links;
DROP POLICY IF EXISTS "memory_links_authenticated_insert" ON memory_links;
DROP POLICY IF EXISTS "memory_links_authenticated_update" ON memory_links;

CREATE POLICY "memory_links_tenant_select" ON memory_links FOR SELECT TO authenticated USING (
  source_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
  AND target_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
);
CREATE POLICY "memory_links_tenant_insert" ON memory_links FOR INSERT TO authenticated WITH CHECK (
  source_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
  AND target_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
);
CREATE POLICY "memory_links_tenant_update" ON memory_links FOR UPDATE TO authenticated USING (
  source_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
  AND target_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
) WITH CHECK (
  source_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
  AND target_id IN (SELECT id FROM memories WHERE is_tenant_member(tenant_id))
);

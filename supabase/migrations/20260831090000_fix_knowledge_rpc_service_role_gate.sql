-- ============================================================
-- Milestone 5, Stage 2 — Governance (M5-13 correction)
--
-- The tenant-membership check added to upsert_structured_fact,
-- replace_structured_fact, match_structured_facts, and get_fact_history in
-- 20260830120000 checked is_tenant_member(), which resolves against
-- auth.uid() — populated only for a real browser session (anon key + user
-- JWT). Per this project's own established V1 security posture
-- (lib/supabase/client.ts resolves to the SERVICE-ROLE key automatically in
-- every server context), the app's real server-side callers have no
-- auth.uid() at all and were being rejected outright — confirmed live via
-- the app's actual service-role client immediately after the prior
-- migration shipped.
--
-- Fix: only enforce is_tenant_member() for a non-service-role caller (a
-- genuine anon-key/browser session — the actual attack surface this check
-- exists for). Server-side calls are already gated upstream at the API
-- route layer via requireUser()/isTenantMember(), matching how RLS is
-- already NOT relied upon as a backstop for API routes in this project.
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_structured_fact(
  p_subject text,
  p_predicate text,
  p_object text,
  p_tenant_id uuid,
  p_category fact_category DEFAULT 'fact',
  p_confidence int DEFAULT 100,
  p_confidence_source text DEFAULT 'user',
  p_confidence_reason text DEFAULT NULL,
  p_importance memory_importance DEFAULT 'high',
  p_tags text[] DEFAULT '{}',
  p_semantic_memory_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  action text,
  fact_id uuid,
  conflict boolean,
  old_value text,
  old_fact_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing_id uuid;
  existing_object text;
  existing_confidence int;
  new_id uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', p_tenant_id;
  END IF;

  SELECT id, object, confidence INTO existing_id, existing_object, existing_confidence
  FROM structured_facts
  WHERE subject = p_subject
    AND predicate = p_predicate
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND superseded_by IS NULL
  LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO structured_facts (
      subject, predicate, object, tenant_id, category, confidence,
      confidence_source, confidence_reason, importance, tags,
      semantic_memory_id, metadata
    ) VALUES (
      p_subject, p_predicate, p_object, p_tenant_id, p_category, p_confidence,
      p_confidence_source, p_confidence_reason, p_importance, p_tags,
      p_semantic_memory_id, p_metadata
    )
    RETURNING id INTO new_id;

    INSERT INTO fact_revisions (fact_id, tenant_id, revision_type, new_value, new_confidence, reason)
    VALUES (new_id, p_tenant_id, 'created', p_object, p_confidence, p_confidence_reason);

    RETURN QUERY SELECT 'created'::text, new_id, false, NULL::text, NULL::uuid;
  ELSIF existing_object = p_object THEN
    RETURN QUERY SELECT 'duplicate'::text, existing_id, false, existing_object, NULL::uuid;
  ELSE
    RETURN QUERY SELECT 'conflict'::text, existing_id, true, existing_object, existing_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION replace_structured_fact(
  p_old_fact_id uuid,
  p_new_object text,
  p_reason text DEFAULT NULL,
  p_new_confidence int DEFAULT NULL,
  p_new_confidence_reason text DEFAULT NULL
)
RETURNS TABLE (new_fact_id uuid, old_fact_id uuid, new_version int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_record RECORD;
  new_id uuid;
  new_version int;
  new_conf int;
BEGIN
  SELECT * INTO old_record FROM structured_facts WHERE id = p_old_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fact % not found', p_old_fact_id;
  END IF;

  IF auth.role() <> 'service_role' AND NOT is_tenant_member(old_record.tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', old_record.tenant_id;
  END IF;

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  UPDATE structured_facts SET deleted_at = now() WHERE id = p_old_fact_id;

  INSERT INTO structured_facts (
    subject, predicate, object, tenant_id, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.tenant_id, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  UPDATE structured_facts
  SET superseded_by = new_id, deleted_at = NULL
  WHERE id = p_old_fact_id;

  INSERT INTO fact_revisions (fact_id, tenant_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, old_record.tenant_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;

CREATE OR REPLACE FUNCTION match_structured_facts(
  p_tenant_id uuid,
  p_subject text DEFAULT NULL,
  p_predicate text DEFAULT NULL,
  p_categories fact_category[] DEFAULT NULL,
  p_search_text text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  confidence_source text,
  confidence_reason text,
  verified boolean,
  importance memory_importance,
  tags text[],
  semantic_memory_id uuid,
  metadata jsonb,
  superseded_by uuid,
  version int,
  previous_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', p_tenant_id;
  END IF;

  IF p_subject IS NOT NULL AND p_predicate IS NOT NULL THEN
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.predicate = p_predicate
      AND sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
    LIMIT 1;
  ELSIF p_subject IS NOT NULL THEN
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSIF p_search_text IS NOT NULL THEN
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE (sf.object ILIKE '%' || p_search_text || '%'
           OR sf.predicate ILIKE '%' || p_search_text || '%')
      AND sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.tenant_id = p_tenant_id
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_fact_history(
  p_subject text,
  p_predicate text,
  p_tenant_id uuid
)
RETURNS TABLE (
  id uuid,
  subject text,
  predicate text,
  object text,
  category fact_category,
  confidence int,
  version int,
  superseded_by uuid,
  previous_version_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_tenant_member(p_tenant_id) THEN
    RAISE EXCEPTION 'not a member of tenant %', p_tenant_id;
  END IF;

  RETURN QUERY
  SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
         sf.confidence, sf.version, sf.superseded_by, sf.previous_version_id,
         sf.created_at
  FROM structured_facts sf
  WHERE sf.subject = p_subject
    AND sf.predicate = p_predicate
    AND sf.tenant_id = p_tenant_id
    AND sf.deleted_at IS NULL
  ORDER BY sf.version ASC;
END;
$$;

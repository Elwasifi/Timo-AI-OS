/*
# Fix match_structured_facts column ambiguity

The PL/pgSQL function parameters (p_subject, p_predicate, etc.) shadowed
table column names (subject, predicate), causing "column reference is
ambiguous" errors. This migration recreates the function with table-qualified
column references (sf.subject, sf.predicate, etc.).
*/

DROP FUNCTION IF EXISTS match_structured_facts(text, text, fact_category[], text, int);

CREATE OR REPLACE FUNCTION match_structured_facts(
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
  IF p_subject IS NOT NULL AND p_predicate IS NOT NULL THEN
    -- O(1) direct lookup
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.predicate = p_predicate
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
    LIMIT 1;
  ELSIF p_subject IS NOT NULL THEN
    -- All active facts for a subject
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.subject = p_subject
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSIF p_search_text IS NOT NULL THEN
    -- ILIKE search across object and predicate
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE (sf.object ILIKE '%' || p_search_text || '%'
           OR sf.predicate ILIKE '%' || p_search_text || '%')
      AND sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  ELSE
    -- Browse all active facts
    RETURN QUERY
    SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
           sf.confidence, sf.confidence_source, sf.confidence_reason,
           sf.verified, sf.importance, sf.tags, sf.semantic_memory_id,
           sf.metadata, sf.superseded_by, sf.version, sf.previous_version_id,
           sf.deleted_at, sf.created_at, sf.updated_at
    FROM structured_facts sf
    WHERE sf.deleted_at IS NULL
      AND sf.superseded_by IS NULL
      AND (p_categories IS NULL OR sf.category = ANY(p_categories))
    ORDER BY sf.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

-- Also fix get_fact_history with the same ambiguity issue
DROP FUNCTION IF EXISTS get_fact_history(text, text);

CREATE OR REPLACE FUNCTION get_fact_history(
  p_subject text,
  p_predicate text
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
  RETURN QUERY
  SELECT sf.id, sf.subject, sf.predicate, sf.object, sf.category,
         sf.confidence, sf.version, sf.superseded_by, sf.previous_version_id,
         sf.created_at
  FROM structured_facts sf
  WHERE sf.subject = p_subject
    AND sf.predicate = p_predicate
    AND sf.deleted_at IS NULL
  ORDER BY sf.version ASC;
END;
$$;
/*
# Fix replace_structured_fact FK constraint

The superseded_by column has a self-referential FK constraint, so we can't
set it to a placeholder UUID that doesn't exist yet. Instead, we mark the
old fact as "superseded" by setting deleted_at temporarily (which removes
it from the unique index), insert the new fact, then clear deleted_at and
set superseded_by to the new fact's ID.
*/

DROP FUNCTION IF EXISTS replace_structured_fact(uuid, text, text, int, text);

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

  new_version := old_record.version + 1;
  new_conf := COALESCE(p_new_confidence, old_record.confidence);

  -- Temporarily mark old fact as deleted to free up the unique index slot.
  -- The deleted_at column is part of the partial unique index condition
  -- (WHERE deleted_at IS NULL AND superseded_by IS NULL), so setting it
  -- removes the row from the index.
  UPDATE structured_facts SET deleted_at = now() WHERE id = p_old_fact_id;

  -- Insert the new version
  INSERT INTO structured_facts (
    subject, predicate, object, category, confidence,
    confidence_source, confidence_reason, importance, tags,
    semantic_memory_id, metadata, version, previous_version_id
  ) VALUES (
    old_record.subject, old_record.predicate, p_new_object, old_record.category,
    new_conf, old_record.confidence_source, COALESCE(p_new_confidence_reason, old_record.confidence_reason),
    old_record.importance, old_record.tags, old_record.semantic_memory_id,
    old_record.metadata, new_version, p_old_fact_id
  )
  RETURNING id INTO new_id;

  -- Now set the old fact's superseded_by to the new fact and clear deleted_at
  UPDATE structured_facts
  SET superseded_by = new_id, deleted_at = NULL
  WHERE id = p_old_fact_id;

  -- Create revision record
  INSERT INTO fact_revisions (fact_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;
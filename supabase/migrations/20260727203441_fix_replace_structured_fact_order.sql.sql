/*
# Fix replace_structured_fact order of operations

The function tried to INSERT the new fact before marking the old one as
superseded, which violated the partial unique index on (subject, predicate)
for active facts. Fixed by marking the old fact as superseded FIRST, then
inserting the new version.
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

  -- Mark old fact as superseded FIRST (frees up the unique index slot)
  UPDATE structured_facts
  SET superseded_by = gen_random_uuid()  -- placeholder UUID, will be updated
  WHERE id = p_old_fact_id;

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

  -- Now update the old fact's superseded_by to point to the real new fact
  UPDATE structured_facts
  SET superseded_by = new_id
  WHERE id = p_old_fact_id;

  -- Create revision record
  INSERT INTO fact_revisions (fact_id, revision_type, old_value, new_value, old_confidence, new_confidence, reason)
  VALUES (new_id, 'superseded', old_record.object, p_new_object, old_record.confidence, new_conf, p_reason);

  RETURN QUERY SELECT new_id, p_old_fact_id, new_version;
END;
$$;
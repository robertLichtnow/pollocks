ALTER TABLE jobs
  RENAME COLUMN identifier TO pattern;

DROP FUNCTION add_job(text, jsonb, text, timestamptz, integer);

CREATE FUNCTION add_job(
  p_id text,
  p_payload jsonb,
  p_pattern text,
  p_run_after timestamptz,
  p_lock_for integer
)
RETURNS text
LANGUAGE sql
AS $$
  INSERT INTO jobs (id, payload, pattern, run_after, lock_for)
  VALUES (p_id, p_payload, p_pattern, p_run_after, p_lock_for)
  RETURNING id;
$$;

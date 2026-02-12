CREATE OR REPLACE FUNCTION add_job(
  p_id text,
  p_payload jsonb,
  p_identifier text,
  p_run_after timestamptz,
  p_lock_for integer
)
RETURNS text
LANGUAGE sql
AS $$
  INSERT INTO jobs (id, payload, identifier, run_after, lock_for)
  VALUES (p_id, p_payload, p_identifier, p_run_after, p_lock_for)
  RETURNING id;
$$;

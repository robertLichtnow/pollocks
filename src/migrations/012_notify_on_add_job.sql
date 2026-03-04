CREATE OR REPLACE FUNCTION add_job(
  p_id text,
  p_payload jsonb,
  p_pattern text,
  p_run_after timestamptz,
  p_lock_for integer
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_id text;
BEGIN
  INSERT INTO jobs (id, payload, pattern, run_after, lock_for)
  VALUES (p_id, p_payload, p_pattern, p_run_after, p_lock_for)
  RETURNING id INTO v_id;

  PERFORM pg_notify('pollocks_new_job', p_pattern);

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION add_jobs(p_jobs jsonb)
RETURNS SETOF text
LANGUAGE plpgsql
AS $$
DECLARE
  v_pattern text;
BEGIN
  RETURN QUERY
    INSERT INTO jobs (id, payload, pattern, run_after, lock_for)
    SELECT
      j->>'id',
      (j->'payload')::jsonb,
      j->>'pattern',
      (j->>'run_after')::timestamptz,
      (j->>'lock_for')::integer
    FROM jsonb_array_elements(p_jobs) AS j
    RETURNING id;

  FOR v_pattern IN
    SELECT DISTINCT j->>'pattern'
    FROM jsonb_array_elements(p_jobs) AS j
  LOOP
    PERFORM pg_notify('pollocks_new_job', v_pattern);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION add_jobs(p_jobs jsonb)
RETURNS SETOF text
LANGUAGE sql
AS $$
  INSERT INTO jobs (id, payload, pattern, run_after, lock_for)
  SELECT
    j->>'id',
    (j->'payload')::jsonb,
    j->>'pattern',
    (j->>'run_after')::timestamptz,
    (j->>'lock_for')::integer
  FROM jsonb_array_elements(p_jobs) AS j
  RETURNING id;
$$;

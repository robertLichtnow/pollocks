CREATE OR REPLACE FUNCTION complete_job(p_id text)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM jobs WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION complete_jobs(p_ids text[])
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM jobs WHERE id = ANY(p_ids);
$$;

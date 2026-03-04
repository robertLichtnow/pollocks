CREATE FUNCTION fail_job(p_id text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE jobs
  SET
    updated_at = now(),
    locked_by = NULL,
    locked_until = NULL,
    locked_at = NULL,
    last_error = p_error
  WHERE id = p_id;
$$;

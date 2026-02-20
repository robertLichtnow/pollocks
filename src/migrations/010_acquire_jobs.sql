CREATE FUNCTION acquire_jobs(p_max integer, p_locked_by text DEFAULT NULL, p_patterns text[] DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE sql
AS $$
  WITH selected AS (
    SELECT id, lock_for
    FROM jobs
    WHERE run_after <= now()
      AND (locked_until IS NULL OR locked_until < now())
      AND attempts < max_attempts
      AND (p_patterns IS NULL OR pattern = ANY(p_patterns))
    ORDER BY run_after
    FOR UPDATE SKIP LOCKED
    LIMIT p_max
  ),
  updated AS (
    UPDATE jobs j
    SET
      updated_at = now(),
      locked_by = coalesce(p_locked_by, 'administrator'),
      locked_until = now() + s.lock_for * interval '1 second',
      locked_at = now(),
      attempts = j.attempts + 1
    FROM selected s
    WHERE j.id = s.id
    RETURNING j.*
  )
  SELECT * FROM updated ORDER BY run_after;
$$;

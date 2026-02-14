ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 10;

CREATE OR REPLACE FUNCTION acquire_job(p_locked_by text DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE sql
AS $$
  WITH selected AS (
    SELECT id, lock_for
    FROM jobs
    WHERE run_after <= now()
      AND (locked_until IS NULL OR locked_until < now())
      AND attempts < max_attempts
    ORDER BY run_after
    FOR UPDATE SKIP LOCKED
    LIMIT 1
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
  SELECT * FROM updated;
$$;

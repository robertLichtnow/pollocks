-- Rewrite acquire_job and acquire_jobs as PL/pgSQL with separate code paths
-- so Postgres can use idx_jobs_pattern_run_after when patterns are provided
-- and idx_jobs_run_after when they are not.
--
-- The previous SQL-language functions used (p_patterns IS NULL OR pattern = ANY(p_patterns))
-- which prevented the planner from pushing the pattern condition into an index scan.
--
-- We use EXECUTE (dynamic SQL) instead of RETURN QUERY to prevent PL/pgSQL
-- from caching a generic plan that ignores the composite index.

DROP FUNCTION IF EXISTS acquire_job(text, text[]);

CREATE FUNCTION acquire_job(p_locked_by text DEFAULT NULL, p_patterns text[] DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_patterns IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'WITH selected AS (
        SELECT id, lock_for
        FROM jobs
        WHERE pattern = ANY($1)
          AND run_after <= now()
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
          locked_by = coalesce($2, ''administrator''),
          locked_until = now() + s.lock_for * interval ''1 second'',
          locked_at = now(),
          attempts = j.attempts + 1
        FROM selected s
        WHERE j.id = s.id
        RETURNING j.*
      )
      SELECT * FROM updated'
    USING p_patterns, p_locked_by;
  ELSE
    RETURN QUERY EXECUTE
      'WITH selected AS (
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
          locked_by = coalesce($1, ''administrator''),
          locked_until = now() + s.lock_for * interval ''1 second'',
          locked_at = now(),
          attempts = j.attempts + 1
        FROM selected s
        WHERE j.id = s.id
        RETURNING j.*
      )
      SELECT * FROM updated'
    USING p_locked_by;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS acquire_jobs(integer, text, text[]);

CREATE FUNCTION acquire_jobs(p_max integer, p_locked_by text DEFAULT NULL, p_patterns text[] DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_patterns IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'WITH selected AS (
        SELECT id, lock_for
        FROM jobs
        WHERE pattern = ANY($1)
          AND run_after <= now()
          AND (locked_until IS NULL OR locked_until < now())
          AND attempts < max_attempts
        ORDER BY run_after
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      ),
      updated AS (
        UPDATE jobs j
        SET
          updated_at = now(),
          locked_by = coalesce($3, ''administrator''),
          locked_until = now() + s.lock_for * interval ''1 second'',
          locked_at = now(),
          attempts = j.attempts + 1
        FROM selected s
        WHERE j.id = s.id
        RETURNING j.*
      )
      SELECT * FROM updated ORDER BY run_after'
    USING p_patterns, p_max, p_locked_by;
  ELSE
    RETURN QUERY EXECUTE
      'WITH selected AS (
        SELECT id, lock_for
        FROM jobs
        WHERE run_after <= now()
          AND (locked_until IS NULL OR locked_until < now())
          AND attempts < max_attempts
        ORDER BY run_after
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      ),
      updated AS (
        UPDATE jobs j
        SET
          updated_at = now(),
          locked_by = coalesce($2, ''administrator''),
          locked_until = now() + s.lock_for * interval ''1 second'',
          locked_at = now(),
          attempts = j.attempts + 1
        FROM selected s
        WHERE j.id = s.id
        RETURNING j.*
      )
      SELECT * FROM updated ORDER BY run_after'
    USING p_max, p_locked_by;
  END IF;
END;
$$;

-- Index to support acquire_job/acquire_jobs queries.
-- The acquire query filters on: run_after <= now(), locked_until IS NULL or expired,
-- attempts < max_attempts, and optionally pattern. It orders by run_after.
--
-- A composite index on (run_after) lets Postgres walk the index in order and
-- stop at LIMIT 1 after finding the first qualifying row, avoiding a full
-- table scan + sort.
CREATE INDEX idx_jobs_run_after ON jobs (run_after);

-- Pattern-filtered acquires benefit from a dedicated index so Postgres can
-- narrow to matching patterns first, then scan by run_after within that subset.
CREATE INDEX idx_jobs_pattern_run_after ON jobs (pattern, run_after);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS run_after timestamptz NOT NULL DEFAULT now();

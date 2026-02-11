CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz,
  identifier text NOT NULL,
  locked_by text,
  locked_until timestamptz,
  locked_at timestamptz,
  last_error text
);

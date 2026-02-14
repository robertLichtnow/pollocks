export type Job = {
  id: string;
  created_at: Date;
  payload: Record<string, unknown> | unknown[];
  updated_at: Date | null;
  identifier: string;
  locked_by: string | null;
  locked_until: Date | null;
  locked_at: Date | null;
  last_error: string | null;
  run_after: Date;
  lock_for: number;
  attempts: number;
  max_attempts: number;
};

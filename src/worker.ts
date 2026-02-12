import type { Pool } from "pg";

export type Mode = 'poll' | 'listen';

export interface WorkerConfig {
  /**
   * The number of pools to run in parallel
   * Use `poll` when you have a high volume of jobs and don't need jobs to be picked up immediately.
   * Use `listen` when you have a low volume of jobs and need jobs to be picked up immediately.
   */
  parallelism?: number;
  /**
   * The mode to use for the worker
   */
  mode?: Mode;
}

export const DEFAULT_CONFIG: Required<WorkerConfig> = {
  parallelism: 1,
  mode: 'poll',
}

export class Worker {
  constructor(
    readonly pool: Pool,
    readonly config?: WorkerConfig,
  ) {}


  async start() {
    // TODO: Implement start logic
  }

  async stop() {
    // TODO: Implement stop logic
  }

  get mergedConfig(): Required<WorkerConfig> {
    return {
      ...DEFAULT_CONFIG,
      ...this.config,
    }
  }
}

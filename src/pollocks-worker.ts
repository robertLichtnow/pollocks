import type { Pool, PoolClient } from "pg";
import { Umzug } from "umzug";
import path from "path";
import fs from "fs/promises";
import { PgStorage } from "./pg-storage";

/**
 
 */
export type Mode = 'poll' | 'listen';

export interface PollocksWorkerConfig {
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

export const DEFAULT_CONFIG: Required<PollocksWorkerConfig> = {
  parallelism: 1,
  mode: 'poll',
}

export class PollocksWorker {
  constructor(
    readonly pool: Pool,
    readonly config?: PollocksWorkerConfig,
  ) {}

  private createUmzug(poolClient: PoolClient) {
    const migrationsDir = path.join(import.meta.dirname, 'migrations');
    const migrationsPath = path.join(migrationsDir, '*.sql');
    const storage = new PgStorage(poolClient);
    return new Umzug({
      storage,
      context: poolClient,
      logger: undefined,
      migrations: {
        glob: migrationsPath,
        resolve: ({ name, path, context }) => {
          // Extract just the filename without extension for consistent naming
          const migrationName = path ? path.split('/').pop()?.replace('.sql', '') || name : name;
          return {
            name: migrationName,
            up: async () => {
              const sql = await fs.readFile(path!, "utf8");
    
              const client = context;
              try {
                await client.query("BEGIN");
                await client.query(sql);
                await client.query("COMMIT");
              } catch (err) {
                try {
                  await client.query("ROLLBACK");
                } catch {
                  // If rollback fails, surface original error; connection is still released below.
                }
                throw err;
              }
            },
          };
        },
      },
    });
  }

  async migrate() {
    const client = await this.pool.connect();
    const umzug = this.createUmzug(client);
    try {
      const results = await umzug.up();
      results.forEach((result) => {
        console.log(`Ran migration: ${result.name}`);
      });
      console.log(`Ran ${results.length} migration(s)`);
    } finally {
      client.release();
    }
  }

  async start() {
    // TODO: Implement start logic
  }
  
  async stop() {
    // TODO: Implement stop logic
  }

  get mergedConfig(): Required<PollocksWorkerConfig> {
    return {
      ...DEFAULT_CONFIG,
      ...this.config,
    }
  }
}
import type { Pool, PoolClient } from "pg";
import { Umzug } from "umzug";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { ulid } from "ulid";
import { PgStorage } from "./pg-storage";
import type { Job } from "./types";

const addJobSchema = z.object({
  payload: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .optional()
    .default({}),
  runAfter: z.coerce.date().optional().default(() => new Date()),
  lockFor: z.number().int().positive().optional().default(3600),
  identifier: z.string().min(1),
});

export type AddJobInput = z.infer<typeof addJobSchema>;

export class Tools {
  constructor(readonly pool: Pool) {}

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

  async addJob(input: AddJobInput) {
    const parsed = addJobSchema.parse(input);
    const id = ulid();

    await this.pool.query(
      `SELECT add_job($1, $2::jsonb, $3, $4, $5)`,
      [id, JSON.stringify(parsed.payload), parsed.identifier, parsed.runAfter, parsed.lockFor],
    );
    return { id };
  }

  async acquireJob(lockedBy?: string | null): Promise<Job | undefined> {
    const result = await this.pool.query<Job>(
      `SELECT * FROM acquire_job($1)`,
      [lockedBy ?? null],
    );
    const row = result.rows[0] ?? undefined;
    return row;
  }

  async getJob() {
    // TODO: Implement getJob
  }
}

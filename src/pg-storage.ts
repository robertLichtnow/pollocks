import type { PoolClient } from "pg";
import type { UmzugStorage, MigrationParams } from "umzug";

export class PgStorage implements UmzugStorage<PoolClient> {
  private table = "_migrations";
  constructor(public readonly poolClient: PoolClient) {}

  async ensureTable() {
    await this.poolClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        name text PRIMARY KEY,
        executed_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  // Umzug calls this to know what already ran.
  async executed(_meta?: Pick<MigrationParams<PoolClient>, 'context'>): Promise<string[]> {
    await this.ensureTable();
    const res = await this.poolClient.query(
      `SELECT name FROM ${this.table} ORDER BY name`
    );
    return res.rows.map((r) => r.name as string);
  }

  // Umzug calls this after a migration succeeds.
  async logMigration(params: MigrationParams<PoolClient>): Promise<void> {
    await this.ensureTable();
    await this.poolClient.query(
      `INSERT INTO ${this.table} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [params.name]
    );
  }

  // Used for down migrations
  async unlogMigration(params: MigrationParams<PoolClient>): Promise<void> {
    await this.ensureTable();
    await this.poolClient.query(
      `DELETE FROM ${this.table} WHERE name = $1`,
      [params.name]
    );
  }
}

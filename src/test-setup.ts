import { Pool, type PoolClient } from "pg";
import { Tools } from "./tools.ts";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/pollocks";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  allowExitOnIdle: true,
});

let migrated = false;

export async function migrate(): Promise<void> {
  if (migrated) return;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(72909071)");
    try {
      await new Tools(pool).migrate();
    } finally {
      await client.query("SELECT pg_advisory_unlock(72909071)");
    }
  } finally {
    client.release();
  }
  migrated = true;
}

export interface TestContext {
  tools: Tools;
  query: PoolClient["query"];
  rollback: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const client = await pool.connect();
  await client.query("BEGIN");

  const proxyPool = {
    query: (...args: any[]) => (client.query as any)(...args),
  } as unknown as Pool;

  return {
    tools: new Tools(proxyPool),
    query: client.query.bind(client) as PoolClient["query"],
    rollback: async () => {
      await client.query("ROLLBACK");
      client.release();
    },
  };
}

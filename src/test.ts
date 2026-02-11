import { Pool } from "pg";
import { PollocksWorker } from "./pollocks-worker";

const pool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});

const worker = new PollocksWorker(pool);

await worker.migrate();

await pool.end();

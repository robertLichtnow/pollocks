import { Pool } from "pg";
import { Tools } from "./tools";

const pool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});

const tools = new Tools(pool);

await tools.migrate();

const { id } = await tools.addJob({
  payload: [{ message: "Hello, world!" }],
  identifier: "test",
  runAfter: new Date(),
  lockFor: 3600,
});

console.log(`Job added with id: ${id}`);
await pool.end();

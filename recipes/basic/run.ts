import pg from "pg";
import { Tools } from "pollocks";
import { resolve } from "path";

const dir = import.meta.dirname;

// Run migrations before starting anything
console.log("[run] Running migrations...");
const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});
const tools = new Tools(pool);
await tools.migrate();
await pool.end();
console.log("[run] Migrations complete.");

// Start the worker process
const worker = Bun.spawn(["bun", "run", resolve(dir, "worker.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});

// Give the worker a moment to start, then run the producer
await Bun.sleep(500);

const producer = Bun.spawn(["bun", "run", resolve(dir, "producer.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});

// Propagate signals to both child processes
const shutdown = () => {
  console.log("[run] Received shutdown signal, forwarding to children...");
  producer.kill("SIGTERM");
  worker.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Wait for both to exit
const [producerExitCode, workerExitCode] = await Promise.all([
  producer.exited,
  worker.exited,
]);

console.log(`[run] Producer exited with code ${producerExitCode}.`);
console.log(`[run] Worker exited with code ${workerExitCode}.`);
process.exit(0);

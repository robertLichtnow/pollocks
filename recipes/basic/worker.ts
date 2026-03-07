import pg from "pg";
import { Worker } from "pollocks";

const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});

const worker = new Worker(
  pool,
  {
    "send-email": (job) => {
      console.log("[worker]", JSON.stringify(job, null, 2));
    },
  },
  { mode: "listen" },
);

worker.events.on("start", ({ patterns }) => {
  console.log(`[worker] Started, listening for patterns: ${patterns.join(", ")}`);
});

worker.events.on("stop", () => {
  console.log("[worker] Stopped");
});

const shutdown = async () => {
  console.log("[worker] Shutting down...");
  await worker.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await worker.start();

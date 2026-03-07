import pg from "pg";
import { Tools } from "pollocks";

const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});

const tools = new Tools(pool);

let running = true;
let count = 0;

const shutdown = async () => {
  console.log("[producer] Shutting down...");
  running = false;
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[producer] Started, creating a job every 5 seconds.");

while (running) {
  count++;
  const to = `user-${count}@example.com`;

  const { id } = await tools.addJob({
    pattern: "send-email",
    payload: {
      to,
      subject: "Welcome to Pollocks!",
      body: `Hello user-${count}, your account is ready.`,
    },
  });

  console.log(`[producer] Created job ${id} for ${to}`);
  await Bun.sleep(5000);
}

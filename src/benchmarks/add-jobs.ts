import { Pool } from "pg";
import { Tools } from "../tools.ts";
import { getSystemInfo, formatNumber, appendResults } from "./utils.ts";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/pollocks";

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  allowExitOnIdle: true,
});

const tools = new Tools(pool);
await tools.migrate();

// Clean up any leftover jobs from previous runs
await pool.query("DELETE FROM jobs");

const BATCH_SIZES = [1, 10, 100, 1000];
const DURATION_MS = 5_000;

interface Result {
  batchSize: number;
  totalJobs: number;
  durationMs: number;
  jobsPerSecond: number;
}

const results: Result[] = [];

for (const batchSize of BATCH_SIZES) {
  await pool.query("DELETE FROM jobs");

  const input = Array.from({ length: batchSize }, (_, i) => ({
    pattern: "benchmark.add",
    payload: { index: i },
  }));

  let totalJobs = 0;
  const start = performance.now();

  while (performance.now() - start < DURATION_MS) {
    if (batchSize === 1) {
      await tools.addJob(input[0]!);
    } else {
      await tools.addJobs(input);
    }
    totalJobs += batchSize;
  }

  const elapsed = performance.now() - start;
  const jobsPerSecond = (totalJobs / elapsed) * 1000;

  results.push({
    batchSize,
    totalJobs,
    durationMs: Math.round(elapsed),
    jobsPerSecond: Math.round(jobsPerSecond),
  });

  console.log(
    `Batch size ${batchSize}: ${formatNumber(Math.round(jobsPerSecond))} jobs/sec (${formatNumber(totalJobs)} jobs in ${Math.round(elapsed)}ms)`,
  );
}

// Clean up
await pool.query("DELETE FROM jobs");

const sysInfo = await getSystemInfo();

await appendResults("add-jobs", sysInfo, (lines) => {
  lines.push("");
  lines.push("### Add Jobs Throughput");
  lines.push("");
  lines.push(
    "| Batch Size | Jobs/sec | Total Jobs | Duration |",
  );
  lines.push(
    "|------------|----------|------------|----------|",
  );
  for (const r of results) {
    lines.push(
      `| ${r.batchSize} | ${formatNumber(r.jobsPerSecond)} | ${formatNumber(r.totalJobs)} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    );
  }
});

await pool.end();
console.log("\nResults written to BENCHMARKS.md");

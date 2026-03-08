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

const TABLE_SIZES = [10_000, 100_000, 1_000_000];
const ITERATIONS = 100;
const BATCH_INSERT = 1000;

interface Result {
  tableSize: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p99Ms: number;
}

async function seedJobs(count: number): Promise<void> {
  const runAfter = new Date();
  let inserted = 0;

  while (inserted < count) {
    const batchSize = Math.min(BATCH_INSERT, count - inserted);
    const inputs = Array.from({ length: batchSize }, (_, i) => ({
      pattern: "benchmark.seed",
      payload: { index: inserted + i },
      runAfter,
    }));
    await tools.addJobs(inputs);
    inserted += batchSize;

    if (inserted % 50_000 === 0) {
      console.log(`  Seeded ${formatNumber(inserted)}/${formatNumber(count)} jobs...`);
    }
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

const results: Result[] = [];

for (const tableSize of TABLE_SIZES) {
  console.log(`\nPreparing ${formatNumber(tableSize)} jobs...`);

  await pool.query("DELETE FROM jobs");
  await seedJobs(tableSize);

  // Let Postgres update statistics and flush dirty buffers
  await pool.query("VACUUM ANALYZE jobs");

  // Verify count
  const countResult = await pool.query("SELECT count(*) FROM jobs");
  console.log(`  Table has ${formatNumber(Number(countResult.rows[0].count))} jobs`);

  // Add one acquirable job per iteration, then acquire and complete it
  const latencies: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    // Add a job that's immediately acquirable
    await tools.addJob({
      pattern: "benchmark.acquire",
      payload: { iteration: i },
      runAfter: new Date(),
    });

    const start = performance.now();
    const job = await tools.acquireJob("benchmark-worker", ["benchmark.acquire"]);
    const elapsed = performance.now() - start;

    latencies.push(elapsed);

    if (job) {
      await tools.completeJob(job.id);
    }
  }

  latencies.sort((a, b) => a - b);

  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  results.push({
    tableSize,
    avgMs: Number(avg.toFixed(2)),
    minMs: Number(latencies[0]!.toFixed(2)),
    maxMs: Number(latencies[latencies.length - 1]!.toFixed(2)),
    p50Ms: Number(percentile(latencies, 50).toFixed(2)),
    p99Ms: Number(percentile(latencies, 99).toFixed(2)),
  });

  console.log(
    `  ${formatNumber(tableSize)} jobs: avg=${avg.toFixed(2)}ms p50=${percentile(latencies, 50).toFixed(2)}ms p99=${percentile(latencies, 99).toFixed(2)}ms`,
  );
}

// Clean up
await pool.query("DELETE FROM jobs");

const sysInfo = await getSystemInfo();

await appendResults("acquire-job", sysInfo, (lines) => {
  lines.push("");
  lines.push("### Acquire Job Latency");
  lines.push("");
  lines.push(
    "| Table Size | Avg | Min | P50 | P99 | Max |",
  );
  lines.push(
    "|------------|-----|-----|-----|-----|-----|",
  );
  for (const r of results) {
    lines.push(
      `| ${formatNumber(r.tableSize)} | ${r.avgMs}ms | ${r.minMs}ms | ${r.p50Ms}ms | ${r.p99Ms}ms | ${r.maxMs}ms |`,
    );
  }
});

await pool.end();
console.log("\nResults written to BENCHMARKS.md");

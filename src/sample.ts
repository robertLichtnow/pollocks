import { Pool } from "pg";
import { Tools } from "./tools";
import type { Job } from "./types";

const pool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});

const tools = new Tools(pool);

await tools.migrate();

const { id } = await tools.addJob({
  payload: [{ message: "Hello, world!" }],
  pattern: "test",
  lockFor: 3600,
});

console.log(`Job added with id: ${id}`);

let acquiredJob: Job | undefined;
while ((acquiredJob = await tools.acquireJob()) !== undefined) {
  console.log(`Acquired job: ${JSON.stringify(acquiredJob)}`);
  await tools.completeJob(acquiredJob.id);
  console.log(`Completed job: ${acquiredJob.id}`);
}

console.log("Creating 10 jobs with addJobs...");
const created = await tools.addJobs(
  Array.from({ length: 10 }, (_, i) => ({
    payload: [{ message: "Hello, world!", index: i + 1 }],
    pattern: "test",
    lockFor: 3600,
  })),
);
created.forEach((j, i) => console.log(`Created job ${i + 1}/10: ${j.id}`));

console.log("Acquiring jobs one by one...");
const acquiredIds: string[] = [];
for (let i = 0; i < 10; i++) {
  const job: Job | undefined = await tools.acquireJob();
  if (job) {
    acquiredIds.push(job.id);
    console.log(`Acquired job ${i + 1}/10: ${job.id}`);
  }
}

console.log(`Completing all ${acquiredIds.length} jobs with completeJobs...`);
await tools.completeJobs(acquiredIds);
console.log(`Completed job ids: ${acquiredIds.join(", ")}`);

await pool.end();

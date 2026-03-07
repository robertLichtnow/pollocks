# pollocks

A TypeScript job queue library backed by PostgreSQL. Jobs are stored as rows, locked via PostgreSQL functions, and processed by workers that support both polling and real-time `NOTIFY/LISTEN`.

## Features

- Durable job storage in PostgreSQL (13+)
- Pattern-based job routing to handlers
- Parallel workers with configurable concurrency
- Two processing modes: polling and PostgreSQL `NOTIFY/LISTEN`
- Automatic retries with configurable lock durations
- Batch job creation and acquisition
- Typed event system for observability
- SQL migrations managed automatically via [Umzug](https://github.com/sequelize/umzug)

## Requirements

- Node.js 18+ or Bun
- PostgreSQL 13+
- TypeScript 5+

## Installation

```
npm install pollocks pg
```

`pg` is a peer dependency. You provide your own `Pool` instance.

## Quick start

### Run migrations

pollocks manages its own schema. Call `migrate()` once at startup:

```typescript
import pg from "pg";
import { Tools } from "pollocks";

const pool = new pg.Pool({
  connectionString: "postgres://user:pass@localhost:5432/mydb",
});

const tools = new Tools(pool);
await tools.migrate();
```

### Add jobs

```typescript
const { id } = await tools.addJob({
  pattern: "send-email",
  payload: {
    to: "user@example.com",
    subject: "Welcome",
    body: "Your account is ready.",
  },
});
```

### Process jobs with a worker

```typescript
import { Worker } from "pollocks";

const worker = new Worker(pool, {
  "send-email": async (job) => {
    const { to, subject, body } = job.payload as {
      to: string;
      subject: string;
      body: string;
    };
    await sendEmail(to, subject, body);
  },
});

await worker.start();

// Graceful shutdown
process.on("SIGTERM", async () => {
  await worker.stop();
  await pool.end();
});
```

## API

### `Tools`

The `Tools` class provides direct access to all job queue operations.

```typescript
import { Tools } from "pollocks";

const tools = new Tools(pool);
```

#### `tools.migrate(): Promise<void>`

Runs all pending SQL migrations. Safe to call on every startup; already-applied migrations are skipped.

#### `tools.addJob(input): Promise<{ id: string }>`

Enqueue a single job.

```typescript
await tools.addJob({
  pattern: "send-email",              // required, routes to a handler
  payload: { to: "user@example.com" }, // optional, defaults to {}
  runAfter: new Date("2025-01-01"),    // optional, defaults to now
  lockFor: 3600,                       // optional, lock duration in seconds, defaults to 3600
});
```

| Field      | Type                                     | Default        | Description                              |
|------------|------------------------------------------|----------------|------------------------------------------|
| `pattern`  | `string`                                 | required       | Routes the job to a matching handler     |
| `payload`  | `Record<string, unknown> \| unknown[]`   | `{}`           | Arbitrary JSON data attached to the job  |
| `runAfter` | `Date \| string \| number`               | `new Date()`   | Earliest time the job becomes eligible   |
| `lockFor`  | `number`                                 | `3600`         | Seconds a job stays locked during processing |

#### `tools.addJobs(inputs): Promise<{ id: string }[]>`

Enqueue multiple jobs in a single database call.

```typescript
const jobs = await tools.addJobs([
  { pattern: "send-email", payload: { to: "a@example.com" } },
  { pattern: "send-email", payload: { to: "b@example.com" } },
]);
// jobs = [{ id: "01HX..." }, { id: "01HX..." }]
```

#### `tools.acquireJob(lockedBy?, patterns?): Promise<Job | undefined>`

Lock and return a single eligible job. Returns `undefined` if no job is available.

```typescript
const job = await tools.acquireJob("worker-1", ["send-email"]);
```

#### `tools.acquireJobs(max, lockedBy?, patterns?): Promise<Job[]>`

Lock and return up to `max` eligible jobs.

```typescript
const jobs = await tools.acquireJobs(10, "worker-1", ["send-email"]);
```

#### `tools.completeJob(id): Promise<void>`

Mark a job as completed.

#### `tools.completeJobs(ids): Promise<void>`

Mark multiple jobs as completed.

#### `tools.failJob(id, error?): Promise<void>`

Mark a job as failed. The job will be retried if it has remaining attempts.

```typescript
await tools.failJob(job.id, "Connection timeout");
```

### `Worker`

The `Worker` class handles job processing with automatic acquisition, execution, completion, and failure handling.

```typescript
import { Worker } from "pollocks";

const worker = new Worker(pool, handlers, config);
```

**Parameters:**

| Parameter  | Type               | Description                                     |
|------------|--------------------|-------------------------------------------------|
| `pool`     | `Pool`             | A `pg` connection pool                          |
| `handlers` | `MessageHandlers`  | Map of pattern names to handler functions       |
| `config`   | `WorkerConfig`     | Optional configuration                         |

#### `WorkerConfig`

| Field            | Type               | Default     | Description                                   |
|------------------|---------------------|-------------|-----------------------------------------------|
| `parallelism`    | `number`           | `1`         | Number of concurrent runner loops             |
| `mode`           | `"poll" \| "listen"` | `"poll"`  | Processing mode                               |
| `pollIntervalMs` | `number`           | `2000`      | Milliseconds between poll cycles              |
| `lockedBy`       | `string`           | auto-generated ULID | Identifier for this worker instance |

#### `worker.start(): Promise<void>`

Start processing jobs. Spawns `parallelism` runner loops.

#### `worker.stop(): Promise<void>`

Graceful shutdown. Waits for all in-flight jobs to finish before returning.

#### `worker.kill(): Promise<void>`

Immediate shutdown. Marks all active jobs as failed and returns without waiting.

#### Events

The `worker.events` emitter provides typed events for observability:

```typescript
worker.events.on("start", ({ patterns }) => {
  console.log(`Listening for: ${patterns.join(", ")}`);
});

worker.events.on("success", ({ job, durationMs }) => {
  console.log(`Job ${job.id} completed in ${durationMs}ms`);
});

worker.events.on("failure", ({ job, error, durationMs }) => {
  console.error(`Job ${job.id} failed after ${durationMs}ms:`, error);
});
```

| Event     | Payload                                              | Description                        |
|-----------|------------------------------------------------------|------------------------------------|
| `start`   | `{ patterns: string[] }`                             | Worker has started                 |
| `stop`    | `{}`                                                 | Worker has stopped                 |
| `shutdown`| `{ forced: boolean }`                                | Worker was killed                  |
| `poll`    | `{ runnerId: number }`                               | Runner is polling for jobs         |
| `listen`  | `{ runnerId: number, pattern: string }`              | Runner received a notification     |
| `acquire` | `{ runnerId: number, job: Job }`                     | Runner acquired a job              |
| `success` | `{ runnerId: number, job: Job, durationMs: number }` | Job completed successfully         |
| `failure` | `{ runnerId: number, job: Job, error: unknown, durationMs: number }` | Job failed |

### `Job`

The `Job` type represents a row in the jobs table:

```typescript
type Job = {
  id: string;
  created_at: Date;
  updated_at: Date | null;
  payload: Record<string, unknown> | unknown[];
  pattern: string;
  locked_by: string | null;
  locked_until: Date | null;
  locked_at: Date | null;
  last_error: string | null;
  run_after: Date;
  lock_for: number;
  attempts: number;
  max_attempts: number;
};
```

## Worker modes

### Poll mode

The default mode. Each runner loop calls `acquireJob()` on a fixed interval. Simple, reliable, and works with any PostgreSQL deployment including managed services that restrict `LISTEN`.

```typescript
const worker = new Worker(pool, handlers, {
  mode: "poll",
  pollIntervalMs: 1000,
});
```

### Listen mode

Uses PostgreSQL `NOTIFY/LISTEN` for near-instant job delivery. When a job is added, a notification triggers the worker to acquire it immediately. A periodic poll runs as a safety net to catch any missed notifications.

```typescript
const worker = new Worker(pool, handlers, {
  mode: "listen",
});
```

Listen mode holds one additional database connection for the `LISTEN` subscription.

## License

MIT

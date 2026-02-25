# 🎨 Pollocks

> 🐘 A TypeScript job queue library backed by PostgreSQL.

Simple, reliable, and transactional job processing — powered by PostgreSQL functions and Bun.

---

## ✨ Features

- 📦 **Batch operations** — add and acquire multiple jobs at once
- 🔒 **Row-level locking** — safe concurrent job acquisition via `FOR UPDATE SKIP LOCKED`
- 🔄 **Automatic retries** — configurable `maxAttempts` with built-in retry support
- 🎯 **Pattern matching** — filter jobs by pattern when acquiring
- 🧩 **Transactional migrations** — plain SQL migrations managed by Umzug
- ✅ **Zod validation** — input schemas validated at runtime

---

## 🚀 Quick Start

### Installation

```bash
bun add pollocks pg
```

### Setup

```bash
bun install
bun run docker:up    # 🐳 starts Postgres on localhost:5432
```

### Usage

```typescript
import { Pool } from "pg";
import { Tools } from "pollocks";

const pool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
});

const tools = new Tools(pool);

// 📋 Run migrations
await tools.migrate();

// ➕ Add a job
const { id } = await tools.addJob({
  pattern: "email/welcome",
  payload: { userId: "123", email: "user@example.com" },
});

// ➕ Add multiple jobs at once
await tools.addJobs([
  { pattern: "email/welcome", payload: { userId: "1" } },
  { pattern: "email/welcome", payload: { userId: "2" } },
]);

// 🎣 Acquire the next available job
const job = await tools.acquireJob("worker-1");

// 🎣 Acquire with pattern filtering
const emailJob = await tools.acquireJob("worker-1", ["email/*"]);

// 🎣 Acquire multiple jobs
const jobs = await tools.acquireJobs(5, "worker-1");

// ✅ Mark a job as complete
await tools.completeJob(job.id);

// ✅ Complete multiple jobs
await tools.completeJobs(jobs.map((j) => j.id));
```

---

## 📖 API

### `Tools`

| Method | Description |
|--------|-------------|
| `migrate()` | 🧩 Run pending SQL migrations |
| `addJob(input)` | ➕ Enqueue a single job |
| `addJobs(inputs)` | ➕ Enqueue multiple jobs in batch |
| `acquireJob(lockedBy?, patterns?)` | 🎣 Lock and return the next available job |
| `acquireJobs(max, lockedBy?, patterns?)` | 🎣 Lock and return up to `max` jobs |
| `completeJob(id)` | ✅ Mark a job as completed |
| `completeJobs(ids)` | ✅ Mark multiple jobs as completed |

### `AddJobInput`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pattern` | `string` | *required* | Job type identifier (supports pattern matching on acquire) |
| `payload` | `object \| array` | `{}` | Arbitrary JSON data attached to the job |
| `runAfter` | `Date` | `new Date()` | Earliest time the job can be acquired |
| `lockFor` | `number` | `3600` | Lock duration in seconds |

---

## 🛠️ Development

### Commands

| Command | Description |
|---------|-------------|
| `bun test` | 🧪 Run the test suite |
| `bun run build` | 📦 Build to `dist/` (targeting Node) |
| `bun run lint` | 🔍 Lint with oxlint |
| `bun run migration <name>` | 🧩 Scaffold a new SQL migration |
| `bun run docker:up` | 🐳 Start Postgres container |
| `bun run docker:down` | 🛑 Stop Postgres container |

### Project Structure

```
src/
├── tools.ts          # 🔧 Main Tools class
├── tools.spec.ts     # 🧪 Tests
├── types.ts          # 📝 Job type definition
├── worker.ts         # 👷 Worker class (WIP)
├── pg-storage.ts     # 💾 Umzug storage adapter
├── test-setup.ts     # 🏗️ Test helpers
└── migrations/       # 🧩 SQL migration files
    ├── 001_*.sql
    ├── 002_*.sql
    └── ...
```

### Testing

Tests run against a real Postgres database using Bun's test runner. Each test executes inside a transaction that gets rolled back — so no data is ever committed. 🧹

```bash
bun run docker:up   # 🐳 ensure Postgres is running
bun test            # 🧪 run tests
```

---

## 📄 License

MIT

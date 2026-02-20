# Pollocks

A TypeScript job queue library backed by PostgreSQL. Uses Bun as the runtime.

## Setup

```bash
bun install
bun run docker:up    # starts Postgres (postgres:18.1) on localhost:5432
```

Connection string: `postgres://postgres:postgres@localhost:5432/pollocks`

## Commands

- `bun test` — run tests (requires `bun install` and Postgres running first)
- `bun run build` — build to `dist/` targeting Node
- `bun run lint` — lint with oxlint
- `bun run migration <name>` — scaffold a new SQL migration file
- `bun run docker:up` / `bun run docker:down` — manage the Postgres container

## Architecture

- `src/tools.ts` — main `Tools` class: `migrate()`, `addJob()`, `addJobs()`, `acquireJob()`, `acquireJobs()`, `completeJob()`, `completeJobs()`
- `src/worker.ts` — `Worker` class (stub, not yet implemented)
- `src/types.ts` — `Job` type definition
- `src/pg-storage.ts` — custom Umzug storage adapter for Postgres
- `src/migrations/*.sql` — SQL migrations run via Umzug; each wraps in a transaction
Core job operations (add, acquire, complete) are implemented as PostgreSQL functions. Migrations are plain `.sql` files.

## Testing

Tests run against a real Postgres database using Bun's built-in test runner.

**Before running tests**, ensure:
1. Dependencies are installed: `bun install`
2. Postgres is running: `docker start pollocks-postgres` (or `bun run docker:up` on first run)

- `src/test-setup.ts` — shared pool, singleton migrate with advisory lock, `createTestContext()` helper
- `src/tools.spec.ts` — all Tools class tests (lives alongside `tools.ts`)

**Test isolation**: each test runs inside a transaction that is rolled back in `afterEach`. No data is ever committed, making cleanup instant. Every test file follows this pattern:

```typescript
let ctx: TestContext;
beforeAll(migrate);
beforeEach(async () => { ctx = await createTestContext(); });
afterEach(async () => { await ctx.rollback(); });
```

**`runAfter` in acquire tests**: Postgres `now()` is frozen at `BEGIN` time inside transactions. Tests that call `acquireJob()` must pass an explicit `runAfter` date in the past so the job is eligible for acquisition.

**CI**: GitHub Actions runs tests against Postgres 13–18 via a matrix of service containers (`.github/workflows/test.yml`).

## Conventions

- IDs use ULID (`ulid` package)
- Input validation with Zod
- Migrations are numbered sequentially (`001_`, `002_`, etc.) and are plain SQL
- `pg` is a peer/dev dependency — consumers provide their own `Pool`
- TypeScript strict mode enabled
- Do not include Co-Authored-By lines in commit messages

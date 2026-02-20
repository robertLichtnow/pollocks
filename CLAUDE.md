# Pollocks

A TypeScript job queue library backed by PostgreSQL. Uses Bun as the runtime.

## Setup

```bash
bun install
bun run docker:up    # starts Postgres (postgres:18.1) on localhost:5432
```

Connection string: `postgres://postgres:postgres@localhost:5432/pollocks`

## Commands

- `bun run sample` — run the sample script (creates jobs, acquires them, completes them)
- `bun run build` — build to `dist/` targeting Node
- `bun run lint` — lint with oxlint
- `bun run migration <name>` — scaffold a new SQL migration file
- `bun run docker:up` / `bun run docker:down` — manage the Postgres container

## Architecture

- `src/tools.ts` — main `Tools` class: `migrate()`, `addJob()`, `acquireJob()`, `completeJob()`, `completeJobs()`
- `src/worker.ts` — `Worker` class (stub, not yet implemented)
- `src/types.ts` — `Job` type definition
- `src/pg-storage.ts` — custom Umzug storage adapter for Postgres
- `src/migrations/*.sql` — SQL migrations run via Umzug; each wraps in a transaction
- `src/sample.ts` — example usage script

Core job operations (add, acquire, complete) are implemented as PostgreSQL functions. Migrations are plain `.sql` files.

## Conventions

- IDs use ULID (`ulid` package)
- Input validation with Zod
- Migrations are numbered sequentially (`001_`, `002_`, etc.) and are plain SQL
- `pg` is a peer/dev dependency — consumers provide their own `Pool`
- TypeScript strict mode enabled

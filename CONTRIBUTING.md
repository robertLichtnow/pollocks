# Contributing to pollocks

## Prerequisites

- [Bun](https://bun.sh) (latest)
- [Docker](https://www.docker.com/) (for running PostgreSQL locally)

## Setup

```bash
git clone https://github.com/robertLichtnow/pollocks.git
cd pollocks
bun install
bun run docker:up
```

This starts a PostgreSQL 18 container on `localhost:5432` with user `postgres`, password `postgres`, and database `pollocks`.

## Running tests

```bash
bun test
```

Tests run against the local PostgreSQL instance. Each test uses a transaction that is rolled back after completion, so no data persists between tests.

## Building

```bash
bun run build
```

This runs [bunup](https://bunup.dev), which produces `dist/index.js`, `dist/index.d.ts`, and copies the SQL migration files into `dist/migrations/`.

## Linting

```bash
bun run lint
```

Uses [oxlint](https://oxc.rs/docs/guide/usage/linter.html).

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). A git hook enforces the format locally via [commitlint](https://commitlint.js.org/).

Format: `<type>(<scope>): <description>`

Common types:

| Type   | When to use                           |
|--------|---------------------------------------|
| `feat` | A new feature or capability           |
| `fix`  | A bug fix                             |
| `docs` | Documentation changes only            |
| `test` | Adding or updating tests              |
| `chore`| Tooling, CI, dependencies, etc.       |
| `perf` | Performance improvements              |

Examples:

```
feat: add job priority support
fix: prevent duplicate job acquisition under high concurrency
docs: add listen mode examples to README
test: add coverage for batch job creation
chore: update pg peer dependency range
```

The scope is optional. Breaking changes should include `BREAKING CHANGE:` in the commit body or use `!` after the type (e.g., `feat!: rename acquireJob to claimJob`).

## Adding migrations

```bash
bun run migration <name>
```

This creates a new numbered `.sql` file in `src/migrations/`. Migrations are plain SQL, each wrapped in a transaction at runtime. Number them sequentially (`013_`, `014_`, etc.).

## Pull requests

1. Create a branch from `main`
2. Make your changes with conventional commit messages
3. Ensure `bun test` and `bun run lint` pass
4. Open a PR against `main`

CI will run tests against PostgreSQL 13 through 18, lint the code, verify the build output, and check that all commit messages follow the conventional format.

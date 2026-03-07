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

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please). The process works as follows:

1. PRs are merged into `main` with conventional commit messages.
2. On each push to `main`, release-please scans the new commits and either creates or updates a single open "Release PR". This PR bumps the version in `package.json`, updates `CHANGELOG.md`, and updates `.release-please-manifest.json`. If no conventional commits (`feat:`, `fix:`, etc.) are found, nothing happens.
3. The Release PR stays open and accumulates changes as more PRs are merged. Only `feat:` and `fix:` commits trigger version bumps -- `chore:`, `docs:`, and `test:` commits are excluded from the changelog.
4. When you are ready to cut a release, merge the Release PR. Release-please then creates a GitHub Release with a git tag (e.g., `v1.2.0`).
5. To publish to npm, manually trigger the **Publish** workflow from the Actions tab. Run it with dry-run enabled first to verify the package contents, then run it again with dry-run disabled to publish.

Version bumps follow [semver](https://semver.org/):

- `fix:` commits bump the patch version (e.g., 1.0.0 -> 1.0.1)
- `feat:` commits bump the minor version (e.g., 1.0.0 -> 1.1.0)
- `BREAKING CHANGE:` in the commit body or `!` after the type bumps the major version (e.g., 1.0.0 -> 2.0.0)

#!/usr/bin/env bun
import { readdir, writeFile } from "fs/promises";
import path from "path";

const migrationsDir = path.join(import.meta.dirname, "..", "src", "migrations");
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error("Usage: bun run scripts/new-migration.ts <name>");
  console.error("  name: snake_case, e.g. rename_identifier_to_pattern");
  process.exit(1);
}

const files = await readdir(migrationsDir);
const numbers = files
  .filter((f) => /^\d{3}_/.test(f))
  .map((f) => parseInt(f.slice(0, 3), 10));
const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
const prefix = String(next).padStart(3, "0");
const filename = `${prefix}_${name}.sql`;
const filepath = path.join(migrationsDir, filename);

await writeFile(filepath, "", "utf8");
console.log(`Created ${filepath}`);

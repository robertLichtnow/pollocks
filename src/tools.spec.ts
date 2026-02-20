import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { migrate, createTestContext, pool, type TestContext } from "./test-setup.ts";

let ctx: TestContext;

beforeAll(migrate);
beforeEach(async () => { ctx = await createTestContext(); });
afterEach(async () => { await ctx.rollback(); });

// acquire_job uses Postgres now() which is frozen at transaction start.
// Jobs must have runAfter in the past relative to that frozen time.
const PAST = new Date(Date.now() - 60_000);

describe("migrate", () => {
  test("creates the _migrations tracking table", async () => {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = '_migrations'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  test("records all migrations", async () => {
    const result = await pool.query(
      `SELECT name FROM _migrations ORDER BY name`,
    );
    expect(result.rows.length).toBe(8);
    expect(result.rows[0]?.name).toMatch(/^001_/);
    expect(result.rows[7]?.name).toMatch(/^008_/);
  });

  test("is idempotent", async () => {
    await migrate();
    const result = await pool.query(`SELECT count(*) FROM _migrations`);
    expect(Number(result.rows[0]?.count)).toBe(8);
  });
});

describe("addJob", () => {
  test("creates a job and returns its id", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "email.send" });
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBe(26); // ULID length
  });

  test("persists the job in the database", async () => {
    const { id } = await ctx.tools.addJob({
      pattern: "email.send",
      payload: { to: "user@example.com" },
    });
    const result = await ctx.query("SELECT * FROM jobs WHERE id = $1", [id]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.pattern).toBe("email.send");
    expect(result.rows[0]?.payload).toEqual({ to: "user@example.com" });
  });

  test("defaults payload to empty object", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test" });
    const result = await ctx.query("SELECT payload FROM jobs WHERE id = $1", [id]);
    expect(result.rows[0]?.payload).toEqual({});
  });

  test("defaults lockFor to 3600 seconds", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test" });
    const result = await ctx.query("SELECT lock_for FROM jobs WHERE id = $1", [id]);
    expect(Number(result.rows[0]?.lock_for)).toBe(3600);
  });

  test("defaults runAfter to approximately now", async () => {
    const before = new Date();
    const { id } = await ctx.tools.addJob({ pattern: "test" });
    const after = new Date();
    const result = await ctx.query("SELECT run_after FROM jobs WHERE id = $1", [id]);
    const runAfter = new Date(result.rows[0]?.run_after);
    expect(runAfter.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(runAfter.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  test("accepts a custom runAfter date", async () => {
    const future = new Date("2030-01-01T00:00:00Z");
    const { id } = await ctx.tools.addJob({ pattern: "test", runAfter: future });
    const result = await ctx.query("SELECT run_after FROM jobs WHERE id = $1", [id]);
    expect(new Date(result.rows[0]?.run_after).toISOString()).toBe(future.toISOString());
  });

  test("accepts a custom lockFor value", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", lockFor: 60 });
    const result = await ctx.query("SELECT lock_for FROM jobs WHERE id = $1", [id]);
    expect(Number(result.rows[0]?.lock_for)).toBe(60);
  });

  test("accepts an array payload", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", payload: [1, 2, 3] });
    const result = await ctx.query("SELECT payload FROM jobs WHERE id = $1", [id]);
    expect(result.rows[0]?.payload).toEqual([1, 2, 3]);
  });

  test("generates unique ids for each job", async () => {
    const r1 = await ctx.tools.addJob({ pattern: "test" });
    const r2 = await ctx.tools.addJob({ pattern: "test" });
    const r3 = await ctx.tools.addJob({ pattern: "test" });
    const ids = new Set([r1.id, r2.id, r3.id]);
    expect(ids.size).toBe(3);
  });

  test("rejects empty pattern", async () => {
    expect(ctx.tools.addJob({ pattern: "" })).rejects.toThrow();
  });

  test("rejects missing pattern", async () => {
    // @ts-expect-error testing runtime validation
    expect(ctx.tools.addJob({})).rejects.toThrow();
  });
});

describe("addJobs", () => {
  test("returns empty array for empty input", async () => {
    const result = await ctx.tools.addJobs([]);
    expect(result).toEqual([]);
  });

  test("creates multiple jobs and returns their ids", async () => {
    const results = await ctx.tools.addJobs([
      { pattern: "email.send", payload: { to: "a@b.com" } },
      { pattern: "sms.send", payload: { to: "+1234567890" } },
      { pattern: "push.send", payload: { token: "abc" } },
    ]);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.id).toBeDefined();
      expect(r.id.length).toBe(26);
    }
  });

  test("persists all jobs in the database", async () => {
    await ctx.tools.addJobs([{ pattern: "a" }, { pattern: "b" }]);
    const result = await ctx.query("SELECT count(*) FROM jobs");
    expect(Number(result.rows[0]?.count)).toBe(2);
  });

  test("each job gets a unique id", async () => {
    const results = await ctx.tools.addJobs([
      { pattern: "a" },
      { pattern: "b" },
      { pattern: "c" },
    ]);
    const unique = new Set(results.map((r) => r.id));
    expect(unique.size).toBe(3);
  });

  test("applies defaults for each job", async () => {
    const results = await ctx.tools.addJobs([{ pattern: "test" }]);
    const row = await ctx.query("SELECT * FROM jobs WHERE id = $1", [results[0]!.id]);
    expect(row.rows[0]?.payload).toEqual({});
    expect(Number(row.rows[0]?.lock_for)).toBe(3600);
  });

  test("handles large batch", async () => {
    const inputs = Array.from({ length: 100 }, (_, i) => ({
      pattern: `batch-${i}`,
      payload: { index: i },
    }));
    const results = await ctx.tools.addJobs(inputs);
    expect(results.length).toBe(100);
    const count = await ctx.query("SELECT count(*) FROM jobs");
    expect(Number(count.rows[0]?.count)).toBe(100);
  });

  test("validates each job in the batch", async () => {
    expect(
      ctx.tools.addJobs([{ pattern: "valid" }, { pattern: "" }]),
    ).rejects.toThrow();
  });
});

describe("acquireJob", () => {
  test("returns undefined when no jobs exist", async () => {
    const job = await ctx.tools.acquireJob();
    expect(job).toBeUndefined();
  });

  test("acquires an available job", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", runAfter: PAST });
    const job = await ctx.tools.acquireJob();
    expect(job).toBeDefined();
    expect(job!.id).toBe(id);
    expect(job!.pattern).toBe("test");
  });

  test("sets locked_by to 'administrator' by default", async () => {
    await ctx.tools.addJob({ pattern: "test", runAfter: PAST });
    const job = await ctx.tools.acquireJob();
    expect(job!.locked_by).toBe("administrator");
  });

  test("sets locked_by to custom value", async () => {
    await ctx.tools.addJob({ pattern: "test", runAfter: PAST });
    const job = await ctx.tools.acquireJob("worker-1");
    expect(job!.locked_by).toBe("worker-1");
  });

  test("sets locked_until based on lock_for", async () => {
    await ctx.tools.addJob({ pattern: "test", lockFor: 60, runAfter: PAST });
    const before = Date.now();
    const job = await ctx.tools.acquireJob();
    const lockedUntil = new Date(job!.locked_until!).getTime();
    expect(lockedUntil).toBeGreaterThanOrEqual(before + 59_000);
    expect(lockedUntil).toBeLessThanOrEqual(before + 62_000);
  });

  test("increments attempts on acquire", async () => {
    await ctx.tools.addJob({ pattern: "test", runAfter: PAST });
    const job = await ctx.tools.acquireJob();
    expect(job!.attempts).toBe(1);
  });

  test("does not acquire a locked job", async () => {
    await ctx.tools.addJob({ pattern: "test", lockFor: 3600, runAfter: PAST });
    const first = await ctx.tools.acquireJob();
    expect(first).toBeDefined();
    const second = await ctx.tools.acquireJob();
    expect(second).toBeUndefined();
  });

  test("does not acquire a job with runAfter in the future", async () => {
    const future = new Date(Date.now() + 3_600_000);
    await ctx.tools.addJob({ pattern: "test", runAfter: future });
    const job = await ctx.tools.acquireJob();
    expect(job).toBeUndefined();
  });

  test("acquires jobs in runAfter order (earliest first)", async () => {
    const { id: earlyId } = await ctx.tools.addJob({
      pattern: "early",
      runAfter: new Date(Date.now() - 120_000),
    });
    await ctx.tools.addJob({
      pattern: "late",
      runAfter: new Date(Date.now() - 60_000),
    });
    const job = await ctx.tools.acquireJob();
    expect(job!.id).toBe(earlyId);
    expect(job!.pattern).toBe("early");
  });

  test("does not acquire a job that exceeded max_attempts", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", runAfter: PAST });
    await ctx.query("UPDATE jobs SET attempts = max_attempts WHERE id = $1", [id]);
    const job = await ctx.tools.acquireJob();
    expect(job).toBeUndefined();
  });

  test("re-acquires a job whose lock has expired", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", lockFor: 1, runAfter: PAST });
    const first = await ctx.tools.acquireJob();
    expect(first).toBeDefined();

    // Manually expire the lock
    await ctx.query(
      "UPDATE jobs SET locked_until = now() - interval '1 second' WHERE id = $1",
      [id],
    );

    const second = await ctx.tools.acquireJob();
    expect(second).toBeDefined();
    expect(second!.id).toBe(id);
    expect(second!.attempts).toBe(2);
  });
});

describe("completeJob", () => {
  test("removes the job from the database", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test" });
    await ctx.tools.completeJob(id);
    const result = await ctx.query("SELECT count(*) FROM jobs WHERE id = $1", [id]);
    expect(Number(result.rows[0]?.count)).toBe(0);
  });

  test("does not throw for non-existent job id", async () => {
    await ctx.tools.completeJob("nonexistent-id");
  });

  test("only removes the specified job", async () => {
    const { id: keep } = await ctx.tools.addJob({ pattern: "keep" });
    const { id: remove } = await ctx.tools.addJob({ pattern: "remove" });
    await ctx.tools.completeJob(remove);
    const result = await ctx.query("SELECT id FROM jobs");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.id).toBe(keep);
  });
});

describe("completeJobs", () => {
  test("removes multiple jobs from the database", async () => {
    const { id: id1 } = await ctx.tools.addJob({ pattern: "a" });
    const { id: id2 } = await ctx.tools.addJob({ pattern: "b" });
    const { id: id3 } = await ctx.tools.addJob({ pattern: "c" });
    await ctx.tools.completeJobs([id1, id2, id3]);
    const result = await ctx.query("SELECT count(*) FROM jobs");
    expect(Number(result.rows[0]?.count)).toBe(0);
  });

  test("handles empty array", async () => {
    await ctx.tools.addJob({ pattern: "test" });
    await ctx.tools.completeJobs([]);
    const result = await ctx.query("SELECT count(*) FROM jobs");
    expect(Number(result.rows[0]?.count)).toBe(1);
  });

  test("only removes specified jobs", async () => {
    const { id: id1 } = await ctx.tools.addJob({ pattern: "remove" });
    const { id: id2 } = await ctx.tools.addJob({ pattern: "keep" });
    const { id: id3 } = await ctx.tools.addJob({ pattern: "remove" });
    await ctx.tools.completeJobs([id1, id3]);
    const result = await ctx.query("SELECT id FROM jobs");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.id).toBe(id2);
  });

  test("silently ignores non-existent ids", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test" });
    await ctx.tools.completeJobs([id, "nonexistent-1", "nonexistent-2"]);
    const result = await ctx.query("SELECT count(*) FROM jobs");
    expect(Number(result.rows[0]?.count)).toBe(0);
  });
});

describe("end-to-end", () => {
  test("single job lifecycle: add, acquire, complete", async () => {
    const { id } = await ctx.tools.addJob({
      pattern: "email.send",
      payload: { to: "user@test.com", subject: "Hello" },
      runAfter: PAST,
    });

    const job = await ctx.tools.acquireJob("worker-1");
    expect(job).toBeDefined();
    expect(job!.id).toBe(id);

    await ctx.tools.completeJob(id);

    const next = await ctx.tools.acquireJob();
    expect(next).toBeUndefined();
  });

  test("bulk lifecycle: addJobs, acquire all, completeJobs", async () => {
    const created = await ctx.tools.addJobs(
      Array.from({ length: 5 }, (_, i) => ({
        pattern: `task-${i}`,
        payload: { index: i },
        runAfter: PAST,
      })),
    );
    expect(created.length).toBe(5);

    const acquired: string[] = [];
    let job;
    while ((job = await ctx.tools.acquireJob()) !== undefined) {
      acquired.push(job.id);
    }
    expect(acquired.length).toBe(5);

    await ctx.tools.completeJobs(acquired);

    const count = await ctx.query("SELECT count(*) FROM jobs");
    expect(Number(count.rows[0]?.count)).toBe(0);
  });
});

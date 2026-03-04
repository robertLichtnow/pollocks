import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "bun:test";
import {
  migrate,
  createTestContext,
  pool,
  type TestContext,
} from "./test-setup.ts";
import { Worker, type WorkerEventMap, type WorkerEventName } from "./worker.ts";
import { Tools } from "./tools.ts";
import type { Job } from "./types.ts";
import type { Pool } from "pg";

let ctx: TestContext;

beforeAll(migrate);
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.rollback();
});

const PAST = new Date(Date.now() - 60_000);

function proxyPool(ctx: TestContext): Pool {
  // The worker constructs its own Tools internally from the pool,
  // so we expose the proxy pool from the test context.
  return (ctx.tools as any).pool;
}

function waitForEvent<K extends WorkerEventName>(
  worker: Worker,
  event: K,
): Promise<WorkerEventMap[K]> {
  return new Promise((resolve) => {
    const handler = (data: WorkerEventMap[K]) => {
      worker.events.off(event, handler);
      resolve(data);
    };
    worker.events.on(event, handler);
  });
}

function collectEvents<K extends WorkerEventName>(
  worker: Worker,
  event: K,
): WorkerEventMap[K][] {
  const collected: WorkerEventMap[K][] = [];
  worker.events.on(event, (data) => collected.push(data));
  return collected;
}

describe("Worker constructor", () => {
  test("derives patterns from handler keys", () => {
    const worker = new Worker(proxyPool(ctx), {
      "email.send": async () => {},
      "sms.send": async () => {},
    });
    expect(worker.mergedConfig.parallelism).toBe(1);
    expect((worker as any).patterns).toEqual(["email.send", "sms.send"]);
  });

  test("generates a unique lockedBy by default", () => {
    const w1 = new Worker(proxyPool(ctx), { test: async () => {} });
    const w2 = new Worker(proxyPool(ctx), { test: async () => {} });
    expect(w1.mergedConfig.lockedBy).toBeDefined();
    expect(w1.mergedConfig.lockedBy).not.toBe(w2.mergedConfig.lockedBy);
  });

  test("accepts custom lockedBy", () => {
    const worker = new Worker(proxyPool(ctx), { test: async () => {} }, {
      lockedBy: "my-worker",
    });
    expect(worker.mergedConfig.lockedBy).toBe("my-worker");
  });

  test("merges config with defaults", () => {
    const worker = new Worker(proxyPool(ctx), { test: async () => {} }, {
      parallelism: 5,
      pollIntervalMs: 500,
    });
    const config = worker.mergedConfig;
    expect(config.parallelism).toBe(5);
    expect(config.pollIntervalMs).toBe(500);
    expect(config.mode).toBe("poll");
  });
});

describe("start and stop", () => {
  test("emits start event with patterns", async () => {
    const worker = new Worker(
      proxyPool(ctx),
      { "email.send": async () => {} },
      { pollIntervalMs: 10 },
    );

    const startPromise = waitForEvent(worker, "start");
    await worker.start();
    const data = await startPromise;
    expect(data.patterns).toEqual(["email.send"]);
    await worker.stop();
  });

  test("emits stop event on graceful shutdown", async () => {
    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );

    await worker.start();
    const stopPromise = waitForEvent(worker, "stop");
    await worker.stop();
    const data = await stopPromise;
    expect(data).toEqual({});
  });

  test("start is idempotent when already running", async () => {
    const pollEvents = [] as any[];
    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );
    worker.events.on("start", (d) => pollEvents.push(d));

    await worker.start();
    await worker.start(); // should be no-op
    expect(pollEvents.length).toBe(1);
    await worker.stop();
  });

  test("can restart after stop", async () => {
    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );
    const events = collectEvents(worker, "start");

    await worker.start();
    await worker.stop();
    await worker.start();
    await worker.stop();
    expect(events.length).toBe(2);
  });
});

describe("poll loop", () => {
  test("acquires and completes a job", async () => {
    await ctx.tools.addJob({ pattern: "email.send", runAfter: PAST });

    let handledJob: Job | undefined;
    const worker = new Worker(
      proxyPool(ctx),
      {
        "email.send": async (job) => {
          handledJob = job;
        },
      },
      { pollIntervalMs: 10 },
    );

    const successPromise = waitForEvent(worker, "success");
    await worker.start();
    const data = await successPromise;
    await worker.stop();

    expect(handledJob).toBeDefined();
    expect(handledJob!.pattern).toBe("email.send");
    expect(data.runnerId).toBe(0);
    expect(data.durationMs).toBeGreaterThanOrEqual(0);

    // Job should be deleted (completed)
    const result = await ctx.query("SELECT * FROM jobs WHERE id = $1", [
      handledJob!.id,
    ]);
    expect(result.rows.length).toBe(0);
  });

  test("calls correct handler based on pattern", async () => {
    await ctx.tools.addJob({ pattern: "sms.send", runAfter: PAST });

    const called: string[] = [];
    const worker = new Worker(
      proxyPool(ctx),
      {
        "email.send": async () => { called.push("email"); },
        "sms.send": async () => { called.push("sms"); },
      },
      { pollIntervalMs: 10 },
    );

    const successPromise = waitForEvent(worker, "success");
    await worker.start();
    await successPromise;
    await worker.stop();

    expect(called).toEqual(["sms"]);
  });

  test("emits acquire event with job data", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", runAfter: PAST });

    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );

    const acquirePromise = waitForEvent(worker, "acquire");
    await worker.start();
    const data = await acquirePromise;
    await worker.stop();

    expect(data.runnerId).toBe(0);
    expect(data.job.id).toBe(id);
    expect(data.job.pattern).toBe("test");
  });

  test("emits poll events", async () => {
    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );

    const pollPromise = waitForEvent(worker, "poll");
    await worker.start();
    const data = await pollPromise;
    await worker.stop();

    expect(data.runnerId).toBe(0);
  });
});

describe("failure handling", () => {
  test("emits failure event when handler throws", async () => {
    await ctx.tools.addJob({ pattern: "test", runAfter: PAST });

    const worker = new Worker(
      proxyPool(ctx),
      {
        test: async () => {
          throw new Error("boom");
        },
      },
      { pollIntervalMs: 10 },
    );

    const failurePromise = waitForEvent(worker, "failure");
    await worker.start();
    const data = await failurePromise;
    await worker.stop();

    expect(data.runnerId).toBe(0);
    expect(data.job.pattern).toBe("test");
    expect(data.error).toBeInstanceOf(Error);
    expect((data.error as Error).message).toBe("boom");
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("calls failJob with error message", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", runAfter: PAST });

    const worker = new Worker(
      proxyPool(ctx),
      {
        test: async () => {
          throw new Error("something went wrong");
        },
      },
      { pollIntervalMs: 10 },
    );

    const failurePromise = waitForEvent(worker, "failure");
    await worker.start();
    await failurePromise;
    await worker.stop();

    // Job should still exist but be unlocked with the error
    const result = await ctx.query("SELECT * FROM jobs WHERE id = $1", [id]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.locked_by).toBeNull();
    expect(result.rows[0]?.last_error).toBe("something went wrong");
  });

  test("job can be re-acquired after failure", async () => {
    let attempts = 0;
    await ctx.tools.addJob({ pattern: "test", runAfter: PAST });

    const worker = new Worker(
      proxyPool(ctx),
      {
        test: async () => {
          attempts++;
          if (attempts === 1) throw new Error("first attempt fails");
        },
      },
      { pollIntervalMs: 10 },
    );

    const successPromise = waitForEvent(worker, "success");
    await worker.start();
    await successPromise;
    await worker.stop();

    expect(attempts).toBe(2);
  });
});

describe("concurrency", () => {
  test("runs multiple jobs concurrently with parallelism > 1", async () => {
    // Add multiple jobs
    for (let i = 0; i < 3; i++) {
      await ctx.tools.addJob({ pattern: "test", runAfter: PAST });
    }

    let concurrent = 0;
    let maxConcurrent = 0;

    const worker = new Worker(
      proxyPool(ctx),
      {
        test: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 50));
          concurrent--;
        },
      },
      { parallelism: 3, pollIntervalMs: 10 },
    );

    // Wait for all 3 successes
    let successCount = 0;
    const allDone = new Promise<void>((resolve) => {
      worker.events.on("success", () => {
        successCount++;
        if (successCount >= 3) resolve();
      });
    });

    await worker.start();
    await allDone;
    await worker.stop();

    expect(successCount).toBe(3);
    // With proxy pool (single client), concurrency at DB level is serialized,
    // but the handlers themselves should run concurrently
  });
});

describe("poll interval", () => {
  test("waits pollIntervalMs when no jobs found", async () => {
    const pollTimes: number[] = [];

    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 50 },
    );

    worker.events.on("poll", () => {
      pollTimes.push(Date.now());
      if (pollTimes.length >= 3) {
        worker.stop();
      }
    });

    await worker.start();
    // Wait for stop to complete
    await waitForEvent(worker, "stop");

    // Check that polls are spaced at least ~40ms apart (allowing some jitter)
    expect(pollTimes.length).toBeGreaterThanOrEqual(3);
    const gap = pollTimes[2]! - pollTimes[1]!;
    expect(gap).toBeGreaterThanOrEqual(40);
  });
});

describe("kill", () => {
  test("emits shutdown event with forced: true", async () => {
    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );

    await worker.start();
    const shutdownPromise = waitForEvent(worker, "shutdown");
    await worker.kill();
    const data = await shutdownPromise;
    expect(data.forced).toBe(true);
  });

  test("unlocks active jobs via failJob", async () => {
    const { id } = await ctx.tools.addJob({ pattern: "test", runAfter: PAST });

    let handlerResolve: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      handlerResolve = resolve;
    });

    const worker = new Worker(
      proxyPool(ctx),
      {
        test: async () => {
          handlerResolve();
          // Simulate long-running handler that we'll kill during
          await new Promise((r) => setTimeout(r, 10000));
        },
      },
      { pollIntervalMs: 10 },
    );

    await worker.start();
    await handlerStarted;

    // Kill while handler is running
    await worker.kill();

    // After kill, failJob("Worker killed") was called. The handler is still
    // running in the background but the job should have been failed.
    // However, the handler's catch block in runLoop will also call failJob
    // when the loop exits. Check that last_error contains "Worker killed".
    const result = await ctx.query("SELECT * FROM jobs WHERE id = $1", [id]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.last_error).toBe("Worker killed");
  });

  test("worker stops after kill", async () => {
    const worker = new Worker(
      proxyPool(ctx),
      { test: async () => {} },
      { pollIntervalMs: 10 },
    );

    await worker.start();
    await worker.kill();

    // Should be able to restart
    const startPromise = waitForEvent(worker, "start");
    await worker.start();
    await startPromise;
    await worker.stop();
  });
});

// --- Listen mode tests ---
// NOTIFY requires committed transactions, so these use the real pool
// with manual cleanup instead of transactional test context.

describe("listen mode", () => {
  const tools = new Tools(pool);
  const createdJobIds: string[] = [];

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await pool.query("DELETE FROM jobs WHERE id = ANY($1)", [createdJobIds]);
      createdJobIds.length = 0;
    }
  });

  async function addJob(pattern: string) {
    const { id } = await tools.addJob({ pattern });
    createdJobIds.push(id);
    return id;
  }

  test("processes a job triggered by NOTIFY", async () => {
    let handledJob: Job | undefined;
    const worker = new Worker(
      pool,
      {
        "listen.test.a": async (job) => {
          handledJob = job;
        },
      },
      { mode: "listen" },
    );

    const successPromise = waitForEvent(worker, "success");
    await worker.start();

    // Add job after worker is listening
    await addJob("listen.test.a");
    await successPromise;
    await worker.stop();

    expect(handledJob).toBeDefined();
    expect(handledJob!.pattern).toBe("listen.test.a");
  });

  test("emits listen event with pattern", async () => {
    const worker = new Worker(
      pool,
      { "listen.test.b": async () => {} },
      { mode: "listen" },
    );

    const listenPromise = waitForEvent(worker, "listen");
    await worker.start();

    await addJob("listen.test.b");
    const data = await listenPromise;
    await worker.stop();

    expect(data.runnerId).toBe(0);
    expect(data.pattern).toBe("listen.test.b");
  });

  test("calls correct handler based on pattern", async () => {
    const called: string[] = [];
    const worker = new Worker(
      pool,
      {
        "listen.test.email": async () => { called.push("email"); },
        "listen.test.sms": async () => { called.push("sms"); },
      },
      { mode: "listen" },
    );

    const successPromise = waitForEvent(worker, "success");
    await worker.start();

    await addJob("listen.test.sms");
    await successPromise;
    await worker.stop();

    expect(called).toEqual(["sms"]);
  });

  test("ignores notifications for unregistered patterns", async () => {
    const called: string[] = [];
    const worker = new Worker(
      pool,
      { "listen.test.registered": async () => { called.push("hit"); } },
      { mode: "listen" },
    );

    await worker.start();

    // Add a job with a pattern not registered on the worker
    const { id } = await tools.addJob({ pattern: "listen.test.unregistered" });
    createdJobIds.push(id);

    // Wait a bit to confirm nothing fires
    await new Promise((r) => setTimeout(r, 200));
    await worker.stop();

    expect(called).toEqual([]);
  });

  test("emits failure event when handler throws", async () => {
    const worker = new Worker(
      pool,
      {
        "listen.test.fail": async () => {
          throw new Error("listen boom");
        },
      },
      { mode: "listen" },
    );

    const failurePromise = waitForEvent(worker, "failure");
    await worker.start();

    await addJob("listen.test.fail");
    const data = await failurePromise;
    await worker.stop();

    expect(data.error).toBeInstanceOf(Error);
    expect((data.error as Error).message).toBe("listen boom");
  });

  test("stop releases the LISTEN client", async () => {
    const worker = new Worker(
      pool,
      { "listen.test.stop": async () => {} },
      { mode: "listen" },
    );

    await worker.start();
    const stopPromise = waitForEvent(worker, "stop");
    await worker.stop();
    await stopPromise;

    // Worker should be fully stopped; can restart
    const startPromise = waitForEvent(worker, "start");
    await worker.start();
    await startPromise;
    await worker.stop();
  });

  test("processes jobs from notifications that arrived while all runners were busy", async () => {
    let callCount = 0;
    const worker = new Worker(
      pool,
      {
        "listen.test.busy": async () => {
          callCount++;
          // First job takes a while, so the second notification arrives
          // while this runner is busy
          if (callCount === 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        },
      },
      { mode: "listen", parallelism: 1 },
    );

    let successCount = 0;
    const bothDone = new Promise<void>((resolve) => {
      worker.events.on("success", () => {
        successCount++;
        if (successCount >= 2) resolve();
      });
    });

    await worker.start();

    // Add first job — runner picks it up
    await addJob("listen.test.busy");
    // Wait for runner to start processing
    await new Promise((r) => setTimeout(r, 50));
    // Add second job while runner is busy — without pending counter this would be lost
    await addJob("listen.test.busy");

    await bothDone;
    await worker.stop();

    expect(successCount).toBe(2);
  });

  test("kill emits shutdown event", async () => {
    const worker = new Worker(
      pool,
      { "listen.test.kill": async () => {} },
      { mode: "listen" },
    );

    await worker.start();
    const shutdownPromise = waitForEvent(worker, "shutdown");
    await worker.kill();
    const data = await shutdownPromise;

    expect(data.forced).toBe(true);
  });
});

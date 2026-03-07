import type { Pool, PoolClient } from "pg";
import { ulid } from "ulid";
import { Tools } from "./tools";
import type { Job } from "./types";
import { TypedEventEmitter } from "./typed-event-emitter";

export { TypedEventEmitter } from "./typed-event-emitter";

// --- Types ---

export type MessageHandler = (job: Job) => Promise<void> | void;
export type MessageHandlers = Record<string, MessageHandler>;

export type Mode = "poll" | "listen";

export const CHANNEL = "pollocks_new_job";

export interface WorkerConfig {
  parallelism?: number;
  mode?: Mode;
  pollIntervalMs?: number;
  lockedBy?: string;
}

export const DEFAULT_CONFIG: Required<WorkerConfig> = {
  parallelism: 1,
  mode: "poll",
  pollIntervalMs: 2000,
  lockedBy: "",
};

export interface WorkerEventMap {
  start: { patterns: string[] };
  stop: {};
  shutdown: { forced: boolean };
  poll: { runnerId: number };
  listen: { runnerId: number; pattern: string };
  acquire: { runnerId: number; job: Job };
  success: { runnerId: number; job: Job; durationMs: number };
  failure: { runnerId: number; job: Job; error: unknown; durationMs: number };
}

export type WorkerEventName = keyof WorkerEventMap;

// --- Worker ---

export class Worker {
  readonly tools: Tools;
  readonly events = new TypedEventEmitter<WorkerEventMap>();
  private runners: Promise<void>[] = [];
  private activeJobs = new Map<number, Job>();
  private stopping = false;
  private sleepResolvers = new Set<() => void>();
  private readonly patterns: string[];
  private readonly lockedBy: string;

  // Listen mode state
  private listenClient: PoolClient | null = null;
  private waitingRunners: Array<(pattern: string) => void> = [];

  constructor(
    readonly pool: Pool,
    readonly handlers: MessageHandlers,
    readonly config?: WorkerConfig,
  ) {
    this.tools = new Tools(pool);
    this.patterns = Object.keys(handlers);
    this.lockedBy = config?.lockedBy ?? ulid();
  }

  get mergedConfig(): Required<WorkerConfig> {
    return {
      ...DEFAULT_CONFIG,
      ...this.config,
      lockedBy: this.lockedBy,
    };
  }

  async start(): Promise<void> {
    if (this.runners.length > 0) return;
    this.stopping = false;
    const { parallelism, mode } = this.mergedConfig;

    if (mode === "listen") {
      await this.startListening();
    }

    this.events.emit("start", { patterns: this.patterns });

    for (let i = 0; i < parallelism; i++) {
      this.runners.push(
        mode === "listen" ? this.listenLoop(i) : this.pollLoop(i),
      );
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wakeAllSleepers();
    this.wakeAllWaitingRunners();
    await Promise.all(this.runners);
    this.runners = [];
    await this.stopListening();
    this.events.emit("stop", {});
  }

  async kill(): Promise<void> {
    this.stopping = true;
    this.wakeAllSleepers();
    this.wakeAllWaitingRunners();

    const failPromises = Array.from(this.activeJobs.entries()).map(
      ([, job]) => this.tools.failJob(job.id, "Worker killed").catch(() => {}),
    );
    await Promise.all(failPromises);

    // We can't halt in-flight promises in JS, so we don't await runners.
    // The active jobs have been unlocked via failJob above.
    this.runners = [];
    await this.stopListening();
    this.events.emit("shutdown", { forced: true });
  }

  // --- Listen mode ---

  private async startListening(): Promise<void> {
    this.listenClient = await this.pool.connect();
    await this.listenClient.query(`LISTEN ${CHANNEL}`);
    this.listenClient.on("notification", this.onNotification);
  }

  private async stopListening(): Promise<void> {
    if (!this.listenClient) return;
    this.listenClient.removeListener("notification", this.onNotification);
    this.listenClient.release();
    this.listenClient = null;
  }

  private onNotification = (msg: { channel: string; payload?: string }) => {
    if (msg.channel !== CHANNEL) return;
    const pattern = msg.payload ?? "";
    if (!this.patterns.includes(pattern)) return;

    const waiter = this.waitingRunners.shift();
    if (waiter) {
      waiter(pattern);
    }
  };

  private waitForNotification(): Promise<string> {
    return new Promise((resolve) => {
      if (this.stopping) {
        resolve("");
        return;
      }
      this.waitingRunners.push(resolve);
    });
  }

  private waitForNotificationOrTimeout(timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      if (this.stopping) {
        resolve("");
        return;
      }

      let done = false;

      const onNotification = (pattern: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(pattern);
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const idx = this.waitingRunners.indexOf(onNotification);
        if (idx !== -1) this.waitingRunners.splice(idx, 1);
        resolve("");
      }, timeoutMs);

      this.waitingRunners.push(onNotification);
    });
  }

  private wakeAllWaitingRunners(): void {
    for (const resolve of this.waitingRunners) {
      resolve("");
    }
    this.waitingRunners = [];
  }

  private async listenLoop(runnerId: number): Promise<void> {
    while (!this.stopping) {
      const pattern = await this.waitForNotificationOrTimeout(
        this.mergedConfig.pollIntervalMs,
      );

      if (this.stopping) break;

      if (pattern) {
        this.events.emit("listen", { runnerId, pattern });
      } else {
        this.events.emit("poll", { runnerId });
      }

      // Drain: keep acquiring jobs until none are left, then wait for the
      // next notification (or poll timeout). This handles notifications
      // that arrived while this runner was busy, without assuming we're
      // the only worker.
      let job = await this.tools.acquireJob(this.lockedBy, this.patterns);
      while (job) {
        await this.executeJob(runnerId, job);
        if (this.stopping) break;
        job = await this.tools.acquireJob(this.lockedBy, this.patterns);
      }
    }
  }

  // --- Poll mode ---

  private async pollLoop(runnerId: number): Promise<void> {
    while (!this.stopping) {
      this.events.emit("poll", { runnerId });

      const job = await this.tools.acquireJob(this.lockedBy, this.patterns);

      if (!job) {
        await this.sleep(this.mergedConfig.pollIntervalMs);
        continue;
      }

      await this.executeJob(runnerId, job);
    }
  }

  // --- Shared ---

  private async executeJob(runnerId: number, job: Job): Promise<void> {
    this.events.emit("acquire", { runnerId, job });
    this.activeJobs.set(runnerId, job);

    const handler = this.handlers[job.pattern];
    const startTime = Date.now();

    try {
      await handler!(job);
      const durationMs = Date.now() - startTime;
      await this.tools.completeJob(job.id);
      this.events.emit("success", { runnerId, job, durationMs });
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.tools.failJob(job.id, errorMessage);
      this.events.emit("failure", { runnerId, job, error, durationMs });
    } finally {
      this.activeJobs.delete(runnerId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.sleepResolvers.delete(wake);
        resolve();
      }, ms);
      const wake = () => {
        clearTimeout(timer);
        this.sleepResolvers.delete(wake);
        resolve();
      };
      this.sleepResolvers.add(wake);
    });
  }

  private wakeAllSleepers(): void {
    for (const resolve of this.sleepResolvers) {
      resolve();
    }
    this.sleepResolvers.clear();
  }
}

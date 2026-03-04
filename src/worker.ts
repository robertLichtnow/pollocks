import type { Pool } from "pg";
import { ulid } from "ulid";
import { Tools } from "./tools";
import type { Job } from "./types";
import { TypedEventEmitter } from "./typed-event-emitter";

export { TypedEventEmitter } from "./typed-event-emitter";

// --- Types ---

export type MessageHandler = (job: Job) => Promise<void> | void;
export type MessageHandlers = Record<string, MessageHandler>;

export type Mode = "poll" | "listen";

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
    const { parallelism } = this.mergedConfig;

    this.events.emit("start", { patterns: this.patterns });

    for (let i = 0; i < parallelism; i++) {
      this.runners.push(this.runLoop(i));
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wakeAllSleepers();
    await Promise.all(this.runners);
    this.runners = [];
    this.events.emit("stop", {});
  }

  async kill(): Promise<void> {
    this.stopping = true;
    this.wakeAllSleepers();

    const failPromises = Array.from(this.activeJobs.entries()).map(
      ([, job]) => this.tools.failJob(job.id, "Worker killed").catch(() => {}),
    );
    await Promise.all(failPromises);

    // We can't halt in-flight promises in JS, so we don't await runners.
    // The active jobs have been unlocked via failJob above.
    this.runners = [];
    this.events.emit("shutdown", { forced: true });
  }

  private async runLoop(runnerId: number): Promise<void> {
    while (!this.stopping) {
      this.events.emit("poll", { runnerId });

      const job = await this.tools.acquireJob(this.lockedBy, this.patterns);

      if (!job) {
        await this.sleep(this.mergedConfig.pollIntervalMs);
        continue;
      }

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

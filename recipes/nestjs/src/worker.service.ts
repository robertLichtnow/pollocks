import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type pg from "pg";
import { Worker } from "pollocks";
import { POOL } from "./pollocks.module.ts";

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly worker: Worker;

  constructor(@Inject(POOL) pool: pg.Pool) {
    this.worker = new Worker(
      pool,
      {
        "send-email": (job) => {
          console.log("[worker]", JSON.stringify(job, null, 2));
        },
      },
      { mode: "listen" },
    );

    this.worker.events.on("start", ({ patterns }) => {
      console.log(`[worker] Started, listening for patterns: ${patterns.join(", ")}`);
    });

    this.worker.events.on("stop", () => {
      console.log("[worker] Stopped");
    });
  }

  async onModuleInit() {
    await this.worker.start();
  }

  async onModuleDestroy() {
    await this.worker.stop();
  }
}

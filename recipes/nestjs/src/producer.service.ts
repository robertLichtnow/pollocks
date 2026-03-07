import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Tools } from "pollocks";
import { TOOLS } from "./pollocks.module.ts";

@Injectable()
export class ProducerService implements OnModuleInit, OnModuleDestroy {
  private running = true;
  private count = 0;

  constructor(@Inject(TOOLS) private readonly tools: Tools) {}

  async onModuleInit() {
    console.log("[producer] Started, creating a job every 5 seconds.");
    this.produce();
  }

  async onModuleDestroy() {
    console.log("[producer] Shutting down...");
    this.running = false;
  }

  private async produce() {
    while (this.running) {
      this.count++;
      const to = `user-${this.count}@example.com`;

      const { id } = await this.tools.addJob({
        pattern: "send-email",
        payload: {
          to,
          subject: "Welcome to Pollocks!",
          body: `Hello user-${this.count}, your account is ready.`,
        },
      });

      console.log(`[producer] Created job ${id} for ${to}`);
      await Bun.sleep(5000);
    }
  }
}

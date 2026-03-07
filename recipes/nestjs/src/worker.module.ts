import { Module } from "@nestjs/common";
import { PollocksModule } from "./pollocks.module.ts";
import { WorkerService } from "./worker.service.ts";

@Module({
  imports: [PollocksModule],
  providers: [WorkerService],
})
export class WorkerModule {}

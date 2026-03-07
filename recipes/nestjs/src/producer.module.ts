import { Module } from "@nestjs/common";
import { PollocksModule } from "./pollocks.module.ts";
import { ProducerService } from "./producer.service.ts";

@Module({
  imports: [PollocksModule],
  providers: [ProducerService],
})
export class ProducerModule {}

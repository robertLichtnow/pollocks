import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./src/worker.module.ts";

const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();

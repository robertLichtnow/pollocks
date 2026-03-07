import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ProducerModule } from "./src/producer.module.ts";

const app = await NestFactory.createApplicationContext(ProducerModule);
app.enableShutdownHooks();

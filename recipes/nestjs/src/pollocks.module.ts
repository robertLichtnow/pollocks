import { Module } from "@nestjs/common";
import pg from "pg";
import { Tools } from "pollocks";

export const POOL = Symbol("POOL");
export const TOOLS = Symbol("TOOLS");

const poolProvider = {
  provide: POOL,
  useFactory: () =>
    new pg.Pool({
      connectionString: "postgres://postgres:postgres@localhost:5432/pollocks",
    }),
};

const toolsProvider = {
  provide: TOOLS,
  useFactory: (pool: pg.Pool) => new Tools(pool),
  inject: [POOL],
};

@Module({
  providers: [poolProvider, toolsProvider],
  exports: [POOL, TOOLS],
})
export class PollocksModule {}

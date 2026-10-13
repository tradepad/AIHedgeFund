import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "@arf/db";
import { QUEUES, redisConnection, startWorker, tracked } from "@arf/event-bus";
import { createLogger, startHealthServer } from "@arf/observability";
import { StorageEnvSchema, createObjectStore } from "@arf/storage";
import { handleReportParse, handleTradesNormalise } from "./handlers";

const EnvSchema = StorageEnvSchema.extend({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  HEALTH_PORT: z.coerce.number().int().default(4101),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  LOG_LEVEL: z.string().default("info"),
});

function verificationIdOf(payload: Record<string, unknown>): string | null {
  return typeof payload.verificationId === "string" ? payload.verificationId : null;
}

function main(): void {
  const env = EnvSchema.parse(process.env);
  const logger = createLogger("worker-backtest", { level: env.LOG_LEVEL });
  const handle = createDb(env.DATABASE_URL);
  const deps = { db: handle.db, store: createObjectStore(env) };
  const ids = (p: { payload: Record<string, unknown> }) => ({ verificationId: verificationIdOf(p.payload) });
  const worker = startWorker(
    QUEUES.backtest,
    redisConnection(env.REDIS_URL),
    {
      "report.parse": tracked(handle.db, logger, QUEUES.backtest, ids, ({ payload }) => handleReportParse(deps, payload)),
      "trades.normalise": tracked(handle.db, logger, QUEUES.backtest, ids, ({ payload }) => handleTradesNormalise(deps, payload)),
    },
    { concurrency: env.WORKER_CONCURRENCY },
  );
  const health = startHealthServer(env.HEALTH_PORT, "worker-backtest", async () => {
    await handle.db.execute(sql`select 1`);
    return worker.isRunning();
  });
  logger.info({ queue: QUEUES.backtest, healthPort: env.HEALTH_PORT }, "worker-backtest started");
  const shutdown = async (): Promise<void> => {
    await worker.close();
    health.close();
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`worker-backtest failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
}

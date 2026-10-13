import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "@arf/db";
import { QUEUES, redisConnection, startWorker, tracked } from "@arf/event-bus";
import { createLogger, startHealthServer } from "@arf/observability";
import { handleEquity, handleMetrics, handleParity, handleReadModel } from "./handlers";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  HEALTH_PORT: z.coerce.number().int().default(4102),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  LOG_LEVEL: z.string().default("info"),
});

function verificationIdOf(payload: Record<string, unknown>): string | null {
  return typeof payload.verificationId === "string" ? payload.verificationId : null;
}

function main(): void {
  const env = EnvSchema.parse(process.env);
  const logger = createLogger("worker-analytics", { level: env.LOG_LEVEL });
  const handle = createDb(env.DATABASE_URL);
  const deps = { db: handle.db };
  const ids = (p: { payload: Record<string, unknown> }) => ({ verificationId: verificationIdOf(p.payload) });
  const worker = startWorker(
    QUEUES.analytics,
    redisConnection(env.REDIS_URL),
    {
      "equity.reconstruct": tracked(handle.db, logger, QUEUES.analytics, ids, ({ payload }) => handleEquity(deps, payload)),
      "metrics.calculate": tracked(handle.db, logger, QUEUES.analytics, ids, ({ payload }) => handleMetrics(deps, payload)),
      "parity.calculate": tracked(handle.db, logger, QUEUES.analytics, ids, ({ payload }) => handleParity(deps, payload)),
      "read_model.refresh": tracked(handle.db, logger, QUEUES.analytics, () => ({}), ({ payload }) => handleReadModel(deps, payload)),
    },
    { concurrency: env.WORKER_CONCURRENCY },
  );
  const health = startHealthServer(env.HEALTH_PORT, "worker-analytics", async () => {
    await handle.db.execute(sql`select 1`);
    return worker.isRunning();
  });
  logger.info({ queue: QUEUES.analytics, healthPort: env.HEALTH_PORT }, "worker-analytics started");
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
  process.stderr.write(`worker-analytics failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
}

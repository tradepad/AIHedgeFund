import { z } from "zod";
import { createLogger, startHealthServer } from "@arf/observability";

const EnvSchema = z.object({
  HEALTH_PORT: z.coerce.number().int().default(4104),
  LOG_LEVEL: z.string().default("info"),
});

/**
 * Forward-testing worker placeholder. The TradingView webhook and paper engine
 * are out of scope for this vertical slice (no live or paper execution exists
 * yet); this process only exposes health so deployment wiring can be tested.
 */
function main(): void {
  const env = EnvSchema.parse(process.env);
  const logger = createLogger("worker-forward", { level: env.LOG_LEVEL });
  const server = startHealthServer(env.HEALTH_PORT, "worker-forward", () => Promise.resolve(true));
  logger.info({ healthPort: env.HEALTH_PORT, capabilities: [] }, "worker-forward started (health only)");
  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main();

import { DevAuthVerifier, createAuthVerifier } from "@arf/auth";
import { createDb } from "@arf/db";
import { EventBus, redisConnection } from "@arf/event-bus";
import { createLogger } from "@arf/observability";
import { createObjectStore } from "@arf/storage";
import { WorkflowEngine } from "@arf/workflow";
import { buildApp } from "./app";
import { startOrchestrator, startOutboxRelay } from "./background";
import { loadConfig } from "./config";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger("api", { level: config.LOG_LEVEL });
  const handle = createDb(config.DATABASE_URL);
  const db = handle.db;
  const bus = new EventBus(redisConnection(config.REDIS_URL));
  const auth =
    config.AUTH_MODE === "dev"
      ? new DevAuthVerifier(config.NODE_ENV)
      : createAuthVerifier({ mode: "clerk", nodeEnv: config.NODE_ENV, clerkSecretKey: config.CLERK_SECRET_KEY, clerkAuthorizedParties: config.CLERK_AUTHORIZED_PARTIES?.split(",").map((s) => s.trim()) });
  const workflow = new WorkflowEngine();
  const app = await buildApp({ config, db, store: createObjectStore(config), auth, workflow, logger, bus });

  const stopRelay = config.OUTBOX_RELAY_ENABLED ? startOutboxRelay(db, bus, logger) : null;
  const orchestrator = config.ORCHESTRATOR_ENABLED ? startOrchestrator(db, workflow, config.REDIS_URL, logger) : null;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await stopRelay?.();
    await orchestrator?.close();
    await bus.close();
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT, storage: config.STORAGE_DRIVER, auth: config.AUTH_MODE }, "api listening");
}

main().catch((error: unknown) => {
  // Configuration errors name the variable, never its value.
  process.stderr.write(`api failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
});

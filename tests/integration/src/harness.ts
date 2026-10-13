import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Queue, type Worker } from "bullmq";
import pg from "pg";
import { FixtureModelProvider } from "@arf/agent-runtime";
import { buildApp } from "@arf/api/app";
import { startOrchestrator, startOutboxRelay } from "@arf/api/background";
import { ConfigSchema } from "@arf/api/config";
import { DevAuthVerifier } from "@arf/auth";
import { DEVELOPMENT_ORGS, createDb, runMigrations, seedOrganisations, seedPrompts, type DbHandle } from "@arf/db";
import { EventBus, QUEUES, redisConnection, startWorker, tracked } from "@arf/event-bus";
import { createLogger } from "@arf/observability";
import { LocalObjectStore } from "@arf/storage";
import { WorkflowEngine } from "@arf/workflow";
import { handleEquity, handleMetrics, handleParity, handleReadModel } from "@arf/worker-analytics/handlers";
import { handleReportParse, handleTradesNormalise } from "@arf/worker-backtest/handlers";
import { handleAgentRun } from "@arf/worker-research/handlers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const FIXTURES_DIR = join(ROOT, "pine", "fixtures", "tradingview");
const PROMPT_PATH = join(ROOT, "packages", "agent-runtime", "prompts", "idea-scout", "1.0.0.md");

export const ADMIN_DATABASE_URL = process.env.ARF_TEST_ADMIN_DATABASE_URL ?? "postgres://arf@127.0.0.1:5432/postgres";
/** A dedicated Redis database keeps test queues away from local development. */
export const TEST_REDIS_URL = process.env.ARF_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";

export interface TestDatabase {
  url: string;
  handle: DbHandle;
  drop(): Promise<void>;
}

/** Create a throwaway database, apply every migration and the development seed. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `arf_it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_DATABASE_URL.replace(/\/[^/]*$/, `/${name}`);
  const handle = createDb(url, { max: 10 });
  await runMigrations(handle.db);
  await seedOrganisations(handle.db, DEVELOPMENT_ORGS);
  await seedPrompts(handle.db, [{ role: "IDEA_SCOUT", semver: "1.0.0", path: PROMPT_PATH }]);
  return {
    url,
    handle,
    async drop() {
      await handle.close();
      const c = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function clearQueues(redisUrl = TEST_REDIS_URL): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    const q = new Queue(name, { connection: redisConnection(redisUrl) });
    await q.obliterate({ force: true });
    await q.close();
  }
}

export interface Stack {
  baseUrl: string;
  db: TestDatabase;
  store: LocalObjectStore;
  stop(): Promise<void>;
}

/**
 * Start the API, outbox relay, orchestrator and all pipeline workers
 * in-process against a fresh database and the test Redis database.
 */
export interface StackOptions {
  workers?: boolean;
  fixtureMode?: "valid" | "invalid-then-valid" | "always-invalid";
  rateLimitMax?: number;
  /** Fixed API port; a free port is chosen when omitted. */
  port?: number;
  /** Public base for presigned upload URLs (e.g. the web BFF); defaults to the API itself. */
  uploadBaseUrl?: string;
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const db = await createTestDatabase();
  await clearQueues();
  const port = options.port ?? (await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const uploadBaseUrl = options.uploadBaseUrl ?? baseUrl;
  const storageDir = mkdtempSync(join(tmpdir(), "arf-objects-"));
  const store = new LocalObjectStore(storageDir, "integration-test-signing-secret-0123456789", uploadBaseUrl);
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: db.url,
    REDIS_URL: TEST_REDIS_URL,
    LOCAL_STORAGE_SIGNING_SECRET: "integration-test-signing-secret-0123456789",
    LOCAL_STORAGE_DIR: storageDir,
    UPLOAD_PUBLIC_BASE_URL: uploadBaseUrl,
    RATE_LIMIT_MAX: String(options.rateLimitMax ?? 1000),
    LOG_LEVEL: "silent",
  });
  const logger = createLogger("integration", { level: "silent" });
  const bus = new EventBus(redisConnection(TEST_REDIS_URL));
  const workflow = new WorkflowEngine();
  const app = await buildApp({ config, db: db.handle.db, store, auth: new DevAuthVerifier("test"), workflow, logger, bus });
  await app.listen({ port, host: "127.0.0.1" });

  const workers: Worker[] = [];
  let stopRelay: (() => Promise<void>) | null = null;
  if (options.workers !== false) {
    const conn = redisConnection(TEST_REDIS_URL);
    const d = db.handle.db;
    const ids = (p: { payload: Record<string, unknown> }) => ({ verificationId: typeof p.payload.verificationId === "string" ? p.payload.verificationId : null });
    const fast = { concurrency: 4, settings: { backoffStrategy: () => 50 } };
    workers.push(
      startWorker(QUEUES.backtest, conn, {
        "report.parse": tracked(d, logger, QUEUES.backtest, ids, ({ payload }) => handleReportParse({ db: d, store }, payload)),
        "trades.normalise": tracked(d, logger, QUEUES.backtest, ids, ({ payload }) => handleTradesNormalise({ db: d, store }, payload)),
      }, fast),
      startWorker(QUEUES.analytics, conn, {
        "equity.reconstruct": tracked(d, logger, QUEUES.analytics, ids, ({ payload }) => handleEquity({ db: d }, payload)),
        "metrics.calculate": tracked(d, logger, QUEUES.analytics, ids, ({ payload }) => handleMetrics({ db: d }, payload)),
        "parity.calculate": tracked(d, logger, QUEUES.analytics, ids, ({ payload }) => handleParity({ db: d }, payload)),
        "read_model.refresh": tracked(d, logger, QUEUES.analytics, () => ({}), ({ payload }) => handleReadModel({ db: d }, payload)),
      }, fast),
      startWorker(QUEUES.research, conn, {
        "agent.run": tracked(d, logger, QUEUES.research, ids, ({ payload }) => handleAgentRun({ db: d, store, provider: new FixtureModelProvider(options.fixtureMode ?? "valid") }, payload)),
      }, fast),
      startOrchestrator(d, workflow, TEST_REDIS_URL, logger),
    );
    stopRelay = startOutboxRelay(d, bus, logger, 50);
  }

  return {
    baseUrl,
    db,
    store,
    async stop() {
      await app.close();
      await stopRelay?.();
      await Promise.all(workers.map((w) => w.close()));
      await bus.close();
      await db.drop();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

/** Poll until `check` returns a value or the deadline passes. */
export async function waitFor<T>(what: string, check: () => Promise<T | null | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

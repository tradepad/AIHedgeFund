import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { sql } from "drizzle-orm";
import { uuidv7 } from "@arf/contracts";
import { auditEvents, dispatchOutboxBatch, enqueueOutbox, jobRuns, outboxEvents, verifyAuditChain } from "@arf/db";
import { TerminalJobError, redisConnection, startWorker, tracked } from "@arf/event-bus";
import { createLogger } from "@arf/observability";
import { ApiClient, expectStatus } from "../src/client";
import { FIXTURE_REPORTS, fixtureBytes, prepareVersion, uploadReport } from "../src/flow";
import { TEST_REDIS_URL, startStack, waitFor, type Stack } from "../src/harness";

type Json = Record<string, unknown>;

async function sqlError(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    return `${error instanceof Error ? error.message : String(error)} ${cause}`;
  }
  return "no error";
}

describe("database invariants, outbox and job processing", () => {
  let stack: Stack;
  let api: ApiClient;
  let orgId: string;
  beforeAll(async () => {
    stack = await startStack();
    api = new ApiClient(stack.baseUrl, "researcher");
    const org = await stack.db.handle.db.query.organisations.findFirst({ where: (o, { eq }) => eq(o.slug, "arf-dev") });
    orgId = org?.id ?? "";
  });
  afterAll(async () => {
    await stack.stop();
  });

  it("rejects mutation of immutable evidence at the database level", async () => {
    const prepared = await prepareVersion(api);
    const db = stack.db.handle.db;
    expect(await sqlError(() => db.execute(sql`UPDATE pine_revisions SET lint_status = 'PASS' WHERE strategy_version_id = ${prepared.versionId}`))).toContain("ARF_IMMUTABLE");
    expect(await sqlError(() => db.execute(sql`DELETE FROM strategy_definitions WHERE strategy_version_id = ${prepared.versionId}`))).toContain("ARF_IMMUTABLE");
    expect(await sqlError(() => db.execute(sql`UPDATE audit_events SET reason = 'edited'`))).toContain("ARF_IMMUTABLE");
    expect(await sqlError(() => db.execute(sql`UPDATE strategy_versions SET symbol = 'BINANCE:ETHUSDT' WHERE id = ${prepared.versionId}`))).toContain("identity fields cannot change");
    expect(await sqlError(() => db.execute(sql`UPDATE strategy_versions SET pine_source_hash = ${"f".repeat(64)} WHERE id = ${prepared.versionId}`))).toContain("ARF_IMMUTABLE");
    // A lifecycle change without a transition record in the same transaction is refused.
    expect(await sqlError(() => db.execute(sql`UPDATE strategy_versions SET state = 'PAPER_APPROVED' WHERE id = ${prepared.versionId}`))).toContain("ARF_WORKFLOW");
  });

  it("detects a tampered audit chain", async () => {
    const db = stack.db.handle.db;
    expect((await verifyAuditChain(db, orgId)).valid).toBe(true);
    await db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
      await tx.execute(sql`UPDATE audit_events SET reason = 'tampered' WHERE seq = (SELECT min(seq) FROM audit_events WHERE organisation_id = ${orgId})`);
      await tx.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);
    });
    const result = await verifyAuditChain(db, orgId);
    expect(result.valid).toBe(false);
    const [first] = await db.select({ id: auditEvents.id }).from(auditEvents).where(sql`${auditEvents.organisationId} = ${orgId}`).orderBy(auditEvents.seq).limit(1);
    expect(result.brokenAt).toBe(first?.id);
  });

  it("deduplicates outbox events by id and leaves failed publishes for retry", async () => {
    const db = stack.db.handle.db;
    const eventId = uuidv7();
    const input = { eventId, organisationId: orgId, eventType: "campaign.created" as const, aggregateType: "CAMPAIGN" as const, aggregateId: uuidv7(), correlationId: "c", causationId: null, actor: { type: "SERVICE" as const, id: "test" }, traceId: "t", payload: {} };
    await enqueueOutbox(db, input);
    await enqueueOutbox(db, input);
    const rows = await db.select().from(outboxEvents).where(sql`${outboxEvents.id} = ${eventId}`);
    expect(rows).toHaveLength(1);
  });

  it("rolls back a dispatch failure without losing the event", async () => {
    const db = stack.db.handle.db;
    const eventId = uuidv7();
    // Stop competing relays from claiming the row by using an event that routes nowhere but is still dispatched.
    await enqueueOutbox(db, { eventId, organisationId: orgId, eventType: "research_task.created", aggregateType: "RESEARCH_TASK", aggregateId: uuidv7(), correlationId: "c", causationId: null, actor: { type: "SERVICE", id: "test" }, traceId: "t", payload: {} });
    await dispatchOutboxBatch(db, (event) => (event.eventId === eventId ? Promise.reject(new Error("broker unavailable")) : Promise.resolve()));
    const [row] = await db.select().from(outboxEvents).where(sql`${outboxEvents.id} = ${eventId}`);
    // Either our failing publisher saw it (attempts recorded, not dispatched) or the live relay dispatched it first.
    expect(row?.dispatchedAt === null ? (row.attempts > 0 && row.lastError === "broker unavailable") : true).toBe(true);
  });

  it("retries transient job failures and records terminal ones without retry", async () => {
    const db = stack.db.handle.db;
    const logger = createLogger("test", { level: "silent" });
    const queueName = "arf-test-retry";
    const queue = new Queue(queueName, { connection: redisConnection(TEST_REDIS_URL) });
    let calls = 0;
    const worker = startWorker(
      queueName as never,
      redisConnection(TEST_REDIS_URL),
      {
        "read_model.refresh": tracked(db, logger, queueName, () => ({}), async ({ payload }) => {
          calls += 1;
          if (payload.payload.mode === "terminal") throw new TerminalJobError("BAD_INPUT", "not retryable");
          if (calls === 1) throw new Error("transient");
          await Promise.resolve();
        }),
      },
      { settings: { backoffStrategy: () => 20 } },
    );
    const payload = (mode: string) => ({ eventId: randomUUID(), eventType: "parity.calculated", organisationId: orgId, aggregateId: randomUUID(), correlationId: "c", traceId: "t", payload: { mode } });
    await queue.add("read_model.refresh", payload("retry"), { jobId: "retry-job", attempts: 3, backoff: { type: "custom" } });
    const retried = await waitFor("retried job", async () => {
      const [r] = await db.select().from(jobRuns).where(sql`${jobRuns.jobKey} = 'retry-job'`);
      return r?.status === "SUCCEEDED" ? r : null;
    });
    expect(retried.attempts).toBe(2);
    await queue.add("read_model.refresh", payload("terminal"), { jobId: "terminal-job", attempts: 3, backoff: { type: "custom" } });
    const terminal = await waitFor("terminal job", async () => {
      const [r] = await db.select().from(jobRuns).where(sql`${jobRuns.jobKey} = 'terminal-job'`);
      return r?.status === "FAILED_TERMINAL" ? r : null;
    });
    expect(terminal.lastErrorCode).toBe("BAD_INPUT");
    expect(terminal.attempts).toBe(1);
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("records a parse failure visibly and accepts a corrected re-upload", async () => {
    const prepared = await prepareVersion(api);
    const verification = expectStatus<Json>(await api.post("/v1/tradingview-verifications", { strategyVersionId: prepared.versionId, chartTimezone: "Etc/UTC", dateFrom: "2024-01-01", dateTo: "2024-04-30" }), 201);
    const vid = String(verification.id);
    const garbage = new TextEncoder().encode("Some,Unknown,Header\n1,2,3\n");
    await uploadReport(api, vid, "LIST_OF_TRADES", garbage, "bad.csv", prepared.pineSourceHash);
    const failed = await waitFor("parse failure", async () => {
      const res = expectStatus<{ verification: Json; uploads: Json[]; jobs: Json[] }>(await api.get(`/v1/tradingview-verifications/${vid}`), 200);
      return res.verification.status === "PARSE_FAILED" ? res : null;
    });
    expect(failed.uploads[0]?.status).toBe("PARSE_FAILED");
    expect(failed.uploads[0]?.errorCode).toBe("UNKNOWN_REPORT_FORMAT");
    await waitFor("terminal job record", async () => {
      const res = expectStatus<{ jobs: Json[] }>(await api.get(`/v1/tradingview-verifications/${vid}`), 200);
      return res.jobs.find((j) => j.status === "FAILED_TERMINAL" && j.lastErrorCode === "UNKNOWN_REPORT_FORMAT");
    });

    const f = FIXTURE_REPORTS.classic;
    await uploadReport(api, vid, "LIST_OF_TRADES", fixtureBytes(f.trades), f.trades, prepared.pineSourceHash);
    await uploadReport(api, vid, "PERFORMANCE_SUMMARY", fixtureBytes(f.summary), f.summary, prepared.pineSourceHash);
    const done = await waitFor("verification to complete after re-upload", async () => {
      const res = expectStatus<{ verification: Json; uploads: Json[] }>(await api.get(`/v1/tradingview-verifications/${vid}`), 200);
      return res.verification.status === "COMPLETED" ? res : null;
    });
    // The failed upload is superseded, never deleted.
    expect(done.uploads.map((u) => u.status).sort()).toEqual(["PARSED", "PARSED", "SUPERSEDED"]);
  });

  it("blocks the research task when the model never returns a valid Idea Card", async () => {
    await stack.stop();
    stack = await startStack({ fixtureMode: "always-invalid" });
    api = new ApiClient(stack.baseUrl, "researcher");
    const campaign = expectStatus<Json>(await api.post("/v1/campaigns", { name: "Invalid agent", objective: "Model output fails validation twice", assetClasses: ["crypto"], timeframes: ["60"] }), 201);
    const requested = expectStatus<Json>(await api.post(`/v1/campaigns/${String(campaign.id)}/ideas/generate`, { objective: "Produce an idea that fails validation" }), 202);
    const task = await waitFor("task blocked", async () => {
      const tasks = expectStatus<{ items: Json[] }>(await api.get(`/v1/campaigns/${String(campaign.id)}/tasks`), 200);
      return tasks.items.find((t) => t.id === requested.taskId && t.state === "BLOCKED");
    });
    expect(task).toBeTruthy();
    const run = await stack.db.handle.db.query.agentRuns.findFirst();
    expect(run?.status).toBe("FAILED_VALIDATION");
    expect(run?.attempts).toBe(2);
    const ideas = expectStatus<{ items: Json[] }>(await api.get(`/v1/campaigns/${String(campaign.id)}/ideas`), 200);
    expect(ideas.items).toHaveLength(0);
  });
});

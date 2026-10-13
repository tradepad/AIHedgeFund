import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  CompleteReportUploadRequestSchema,
  CreateDecisionRequestSchema,
  CreateReportUploadRequestSchema,
  CreateVerificationRequestSchema,
  MAX_REPORT_UPLOAD_BYTES,
  StrategyLibraryQuerySchema,
} from "@arf/contracts";
import { LocalObjectStore } from "@arf/storage";
import { z } from "zod";
import type { AppContext } from "../context";
import { authorise } from "../http/auth";
import { runIdempotent } from "../http/idempotency";
import { problems } from "../http/problem";
import { getDecisionContext, recordDecision } from "../services/decisions";
import * as oversight from "../services/oversight";
import * as results from "../services/results";
import * as verifications from "../services/verifications";
import { IdParams, PageQuery, commandRateLimit } from "./shared";

export function evidenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  // --- TradingView verification -------------------------------------------
  app.post("/v1/tradingview-verifications", async (request, reply) => {
    const scope = authorise(request, "verification:write");
    const body = CreateVerificationRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "verification.create", body, async (tx) => ({ status: 201, body: await verifications.createVerification(tx, scope, body) }));
  });

  app.get("/v1/strategy-versions/:id/verifications", async (request) => {
    const scope = authorise(request, "read");
    return { items: await verifications.listVerifications(ctx, scope, IdParams.parse(request.params).id) };
  });

  app.get("/v1/tradingview-verifications/:id", async (request) => {
    const scope = authorise(request, "read");
    return verifications.getVerificationStatus(ctx, scope, IdParams.parse(request.params).id);
  });

  app.post("/v1/tradingview-verifications/:id/uploads", { config: commandRateLimit(ctx.config.RATE_LIMIT_MAX) }, async (request, reply) => {
    const scope = authorise(request, "report:upload");
    const { id } = IdParams.parse(request.params);
    const body = CreateReportUploadRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "upload.create", { id, body }, async (tx) => ({ status: 201, body: await verifications.createUpload(ctx, tx, scope, id, body) }));
  });

  app.post("/v1/tradingview-verifications/:id/uploads/complete", { config: commandRateLimit(ctx.config.RATE_LIMIT_MAX) }, async (request, reply) => {
    const scope = authorise(request, "report:upload");
    const { id } = IdParams.parse(request.params);
    const body = CompleteReportUploadRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "upload.complete", { id, body }, async (tx) => ({ status: 200, body: await verifications.completeUpload(ctx, tx, scope, id, body) }));
  });

  app.get("/v1/tradingview-verifications/:id/parity", async (request) => {
    const scope = authorise(request, "read");
    return verifications.getParity(ctx, scope, IdParams.parse(request.params).id);
  });

  /**
   * Server-sent verification progress. Status is persisted in PostgreSQL, so
   * the stream is a view over the database: a reconnecting client always
   * receives the current snapshot first (event ids are content hashes).
   */
  app.get("/v1/tradingview-verifications/:id/events", async (request, reply) => {
    const scope = authorise(request, "read");
    const { id } = IdParams.parse(request.params);
    await verifications.getVerificationStatus(ctx, scope, id);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-trace-id": request.traceId });
    let last = "";
    let closed = false;
    const tick = async (): Promise<void> => {
      if (closed) return;
      try {
        const view = await verifications.getVerificationStatus(ctx, scope, id);
        const data = JSON.stringify(view);
        const eventId = createHash("sha256").update(data).digest("hex").slice(0, 16);
        if (eventId !== last) {
          raw.write(`id: ${eventId}\nevent: verification\ndata: ${data}\n\n`);
          last = eventId;
        } else raw.write(": keep-alive\n\n");
        if (view.verification.status === "COMPLETED") {
          raw.write("event: end\ndata: {}\n\n");
          closed = true;
          raw.end();
        }
      } catch (error) {
        ctx.logger.warn({ err: error, traceId: request.traceId }, "verification stream failed");
        closed = true;
        raw.end();
      }
    };
    const timer = setInterval(() => void tick(), 1500);
    request.raw.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
    await tick();
  });

  // --- Results --------------------------------------------------------------
  app.get("/v1/backtest-runs/:id", async (request) => {
    const scope = authorise(request, "read");
    return results.getRun(ctx, scope, IdParams.parse(request.params).id);
  });
  app.get("/v1/backtest-runs/:id/trades", async (request) => {
    const scope = authorise(request, "read");
    return results.listTrades(ctx, scope, IdParams.parse(request.params).id, PageQuery.parse(request.query));
  });
  app.get("/v1/backtest-runs/:id/equity", async (request) => {
    const scope = authorise(request, "read");
    return results.getEquity(ctx, scope, IdParams.parse(request.params).id);
  });
  app.get("/v1/backtest-runs/:id/metrics", async (request) => {
    const scope = authorise(request, "read");
    return results.getMetrics(ctx, scope, IdParams.parse(request.params).id);
  });

  // --- Decisions ------------------------------------------------------------
  app.post("/v1/committee/decisions", { config: commandRateLimit(Math.max(5, Math.floor(ctx.config.RATE_LIMIT_MAX / 3))) }, async (request, reply) => {
    const scope = authorise(request, "decision:write");
    const body = CreateDecisionRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "decision.create", body, async (tx, key) => ({ status: 201, body: await recordDecision(ctx, tx, scope, body, key) }));
  });

  app.get("/v1/strategy-versions/:id/decision-context", async (request) => {
    const scope = authorise(request, "read");
    return getDecisionContext(ctx, scope, IdParams.parse(request.params).id);
  });

  // --- Oversight -------------------------------------------------------------
  app.get("/v1/command-centre", async (request) => {
    const scope = authorise(request, "read");
    return oversight.commandCentre(ctx, scope);
  });

  app.get("/v1/strategy-library", async (request) => {
    const scope = authorise(request, "read");
    const q = StrategyLibraryQuerySchema.extend({ campaignId: z.uuid().optional() }).parse(request.query);
    return oversight.strategyLibrary(ctx, scope, q);
  });

  app.get("/v1/strategy-versions/:id/audit", async (request) => {
    const scope = authorise(request, "read");
    return oversight.versionAuditTimeline(ctx, scope, IdParams.parse(request.params).id, PageQuery.parse(request.query));
  });

  app.get("/v1/audit", async (request) => {
    const scope = authorise(request, "audit:read");
    return oversight.organisationAudit(ctx, scope, PageQuery.parse(request.query));
  });

  app.get("/v1/audit/verify", async (request) => {
    const scope = authorise(request, "audit:read");
    return oversight.verifyChain(ctx, scope);
  });

  app.get("/v1/artefacts/:id/content", async (request, reply) => {
    const scope = authorise(request, "read");
    const file = await oversight.readArtefact(ctx, scope, IdParams.parse(request.params).id);
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.fileName}"`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .send(Buffer.from(file.bytes));
  });

  // --- Local presigned-upload target (development storage driver only) --------
  if (ctx.store instanceof LocalObjectStore) {
    const store = ctx.store;
    app.put(
      "/v1/object-uploads/:token",
      { config: { public: true, ...commandRateLimit(ctx.config.RATE_LIMIT_MAX * 2) }, bodyLimit: MAX_REPORT_UPLOAD_BYTES },
      async (request, reply) => {
        const { token } = z.object({ token: z.string().min(10).max(4096) }).parse(request.params);
        if (!Buffer.isBuffer(request.body)) throw problems.badRequest("BODY_REQUIRED", "upload body must be raw file bytes");
        const result = await store.acceptUpload(token, new Uint8Array(request.body));
        if (!result.ok) throw problems.forbidden("UPLOAD_REJECTED", result.reason);
        return reply.status(200).send({ ok: true });
      },
    );
  }
}

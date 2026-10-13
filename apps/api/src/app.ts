import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { MAX_REPORT_UPLOAD_BYTES } from "@arf/contracts";
import { instruments } from "@arf/observability";
import type { AppContext } from "./context";
import { registerAuth } from "./http/auth";
import { errorHandler, problems } from "./http/problem";
import { evidenceRoutes } from "./routes/evidence";
import { researchRoutes } from "./routes/research";

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    // Presigned local-upload tokens are long path parameters.
    routerOptions: { maxParamLength: 4096 },
    trustProxy: ctx.config.NODE_ENV === "production",
    genReqId: () => "",
  });

  // Raw file bodies for the local presigned-upload target only.
  app.addContentTypeParser(
    ["text/csv", "application/octet-stream", "application/vnd.ms-excel"],
    { parseAs: "buffer", bodyLimit: MAX_REPORT_UPLOAD_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.setErrorHandler(errorHandler(ctx.logger));
  app.setNotFoundHandler((request) => {
    throw problems.notFound(`route ${request.method} ${request.url.split("?")[0] ?? ""}`);
  });

  // Per-route limits only (upload completion and decisions). Keyed by the
  // credential hash so one user cannot exhaust another user's budget.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      return typeof auth === "string"
        ? createHash("sha256").update(auth).digest("hex")
        : request.ip;
    },
  });

  registerAuth(app, ctx);

  app.addHook("onResponse", async (request, reply) => {
    instruments.apiLatencyMs.record(reply.elapsedTime, {
      route: request.routeOptions.url ?? "unknown",
      status: reply.statusCode,
    });
    ctx.logger.info(
      {
        traceId: request.traceId,
        method: request.method,
        route: request.routeOptions.url,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        userId: request.principal?.userId,
        organisationId: request.principal?.organisationId,
      },
      "request",
    );
    await Promise.resolve();
  });

  app.get("/healthz", { config: { public: true } }, () =>
    Promise.resolve({ status: "ok", service: "api" }),
  );
  app.get("/readyz", { config: { public: true } }, async (_request, reply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  researchRoutes(app, ctx);
  evidenceRoutes(app, ctx);
  return app;
}

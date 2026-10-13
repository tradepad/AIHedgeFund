import type { FastifyInstance, FastifyRequest } from "fastify";
import { hasPermission, resolvePrincipal, type Permission, type Principal } from "@arf/auth";
import { traceIdFromHeader } from "@arf/observability";
import type { AppContext, RequestScope } from "../context";
import { problems } from "./problem";

export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest("traceId", "");
  app.decorateRequest("principal", null);

  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers.traceparent;
    request.traceId = traceIdFromHeader(typeof header === "string" ? header : undefined);
    void reply.header("x-trace-id", request.traceId);
    await Promise.resolve();
  });

  app.addHook("preHandler", async (request) => {
    if (request.routeOptions.config.public === true) return;
    const verified = await ctx.auth.verify(request.headers.authorization);
    if (!verified.ok) throw problems.unauthenticated(verified.error.detail);
    const org = request.headers["x-arf-org"];
    const principal = await resolvePrincipal(
      ctx.db,
      verified.value,
      typeof org === "string" ? org : undefined,
    );
    if (!principal.ok) {
      if (principal.error.code === "ORGANISATION_REQUIRED")
        throw problems.badRequest(principal.error.code, principal.error.detail);
      throw problems.forbidden(principal.error.code, principal.error.detail);
    }
    request.principal = principal.value;
  });
}

export function principalOf(request: FastifyRequest): Principal {
  if (!request.principal) throw problems.unauthenticated("authentication required");
  return request.principal;
}

/** Authorise a permission and build the service scope for this request. */
export function authorise(request: FastifyRequest, permission: Permission): RequestScope {
  const principal = principalOf(request);
  if (!hasPermission(principal.roles, permission)) {
    throw problems.forbidden(
      "PERMISSION_DENIED",
      `this action requires the ${permission} permission`,
    );
  }
  const correlation = request.headers["x-correlation-id"];
  return {
    principal,
    traceId: request.traceId,
    correlationId:
      typeof correlation === "string" && /^[\w-]{1,100}$/.test(correlation)
        ? correlation
        : request.traceId,
  };
}

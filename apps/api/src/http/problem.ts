import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { toValidationIssues, type ProblemDetails, type ValidationIssue } from "@arf/contracts";
import type { Logger } from "@arf/observability";

/** Typed domain error rendered as RFC 9457 problem details. */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
    readonly errors?: ValidationIssue[],
  ) {
    super(detail);
  }
}

export const problems = {
  badRequest: (code: string, detail: string, errors?: ValidationIssue[]) => new ProblemError(400, code, "Bad request", detail, errors),
  unauthenticated: (detail: string) => new ProblemError(401, "UNAUTHENTICATED", "Authentication required", detail),
  forbidden: (code: string, detail: string) => new ProblemError(403, code, "Forbidden", detail),
  notFound: (what: string) => new ProblemError(404, "NOT_FOUND", "Not found", `${what} was not found`),
  conflict: (code: string, detail: string) => new ProblemError(409, code, "Conflict", detail),
  unprocessable: (code: string, detail: string, errors?: ValidationIssue[]) => new ProblemError(422, code, "Unprocessable request", detail, errors),
};

function render(request: FastifyRequest, status: number, code: string, title: string, detail: string, errors?: ValidationIssue[]): ProblemDetails {
  return {
    type: `https://arf-os.dev/problems/${code.toLowerCase().replace(/_/g, "-")}`,
    title,
    status,
    detail,
    instance: request.url.split("?")[0] ?? request.url,
    code,
    traceId: request.traceId,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}

export function errorHandler(logger: Logger) {
  return (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    let body: ProblemDetails;
    if (error instanceof ProblemError) {
      body = render(request, error.status, error.code, error.title, error.detail, error.errors);
    } else if (error instanceof ZodError) {
      body = render(request, 400, "VALIDATION_FAILED", "Validation failed", "request did not match the contract", toValidationIssues(error));
    } else if ("statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
      const code = error.statusCode === 429 ? "RATE_LIMITED" : (error.code ?? "BAD_REQUEST");
      body = render(request, error.statusCode, code, error.statusCode === 429 ? "Too many requests" : "Bad request", error.statusCode === 429 ? "rate limit exceeded; retry later" : error.message);
    } else {
      // Never expose stack traces, SQL or provider messages to clients.
      logger.error({ err: error, traceId: request.traceId, url: request.url }, "unhandled error");
      body = render(request, 500, "INTERNAL_ERROR", "Internal error", "an unexpected error occurred");
    }
    void reply.status(body.status).header("content-type", "application/problem+json").send(body);
  };
}

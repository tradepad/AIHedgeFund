import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { SpanStatusCode, metrics, trace, type Attributes } from "@opentelemetry/api";
import pino, { type Logger } from "pino";

export type { Logger } from "pino";

/**
 * Keys whose values must never reach logs. Matching is case-insensitive on the
 * final path segment; nested objects are walked by pino's redact paths below.
 */
const REDACT_PATHS = [
  "authorization",
  "*.authorization",
  "headers.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "cookie",
  "*.cookie",
  "password",
  "*.password",
  "secret",
  "*.secret",
  "*.secretKey",
  "token",
  "*.token",
  "apiKey",
  "*.apiKey",
  "prompt",
  "*.prompt",
  "rawOutput",
  "*.rawOutput",
];

export function createLogger(
  service: string,
  options: { level?: string; destination?: pino.DestinationStream } = {},
): Logger {
  const config: pino.LoggerOptions = {
    name: service,
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base: { service },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}

/** 16-byte hex trace id compatible with W3C trace-context. */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** Extract the trace id from a W3C `traceparent` header, or mint a new one. */
export function traceIdFromHeader(traceparent: string | undefined): string {
  if (traceparent) {
    const match = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(traceparent.trim());
    if (match?.[1] && match[1] !== "0".repeat(32)) return match[1];
  }
  return newTraceId();
}

const tracer = trace.getTracer("arf-os");
const meter = metrics.getMeter("arf-os");

/**
 * Run `fn` inside an OpenTelemetry span. With no SDK registered this is a
 * no-op wrapper, so instrumentation is free until an exporter is configured.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "error",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export const instruments = {
  apiLatencyMs: meter.createHistogram("arf.api.latency_ms", { unit: "ms" }),
  jobLatencyMs: meter.createHistogram("arf.job.latency_ms", { unit: "ms" }),
  jobFailures: meter.createCounter("arf.job.failures"),
  parseFailures: meter.createCounter("arf.report.parse_failures"),
  parityFailures: meter.createCounter("arf.parity.failures"),
  modelSchemaFailures: meter.createCounter("arf.model.schema_failures"),
  modelCostUsd: meter.createCounter("arf.model.cost_usd"),
};

/**
 * Minimal liveness/readiness endpoint for background workers. `/healthz`
 * reports the process is up; `/readyz` runs the dependency check.
 */
export function startHealthServer(
  port: number,
  service: string,
  ready: () => Promise<boolean>,
): Server {
  const server = createServer((req, res) => {
    const send = (status: number, body: Record<string, unknown>) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/healthz") return send(200, { status: "ok", service });
    if (req.url === "/readyz") {
      ready().then(
        (ok) => send(ok ? 200 : 503, { status: ok ? "ready" : "unavailable", service }),
        () => send(503, { status: "unavailable", service }),
      );
      return;
    }
    send(404, { status: "not_found" });
  });
  server.listen(port);
  return server;
}

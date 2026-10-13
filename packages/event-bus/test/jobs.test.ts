import { describe, expect, it } from "vitest";
import { DomainEventTypeSchema, uuidv7, type DomainEvent } from "@arf/contracts";
import { EVENT_ROUTES, JobPayloadSchema, jobIdFor, routesFor, toJobPayload } from "../src";

const event = (eventType: DomainEvent["eventType"]): DomainEvent => ({
  eventId: uuidv7(),
  eventType,
  eventVersion: 1,
  organisationId: uuidv7(),
  aggregateType: "VERIFICATION",
  aggregateId: uuidv7(),
  correlationId: "corr",
  causationId: null,
  actor: { type: "USER", id: "u" },
  occurredAt: "2026-01-01T00:00:00Z",
  traceId: "t",
  payload: {},
});

describe("event routing", () => {
  it("routes the report pipeline in order", () => {
    const chain = [
      "report_upload.completed",
      "verification.reports_parsed",
      "trades.normalised",
      "equity.reconstructed",
      "metrics.calculated",
      "parity.calculated",
    ] as const;
    expect(chain.map((t) => routesFor(event(t))[0]?.name)).toEqual([
      "report.parse",
      "trades.normalise",
      "equity.reconstruct",
      "metrics.calculate",
      "parity.calculate",
      "read_model.refresh",
    ]);
  });

  it("produces deterministic, colon-free job ids", () => {
    const e = event("report_upload.completed");
    const route = routesFor(e)[0];
    if (!route) throw new Error("route");
    expect(jobIdFor(e, route)).toBe(jobIdFor({ ...e }, route));
    expect(jobIdFor(e, route)).not.toContain(":");
  });

  it("only routes known event types", () => {
    for (const key of Object.keys(EVENT_ROUTES))
      expect(DomainEventTypeSchema.safeParse(key).success).toBe(true);
  });

  it("produces payloads that validate", () => {
    expect(JobPayloadSchema.safeParse(toJobPayload(event("trades.normalised"))).success).toBe(true);
  });
});

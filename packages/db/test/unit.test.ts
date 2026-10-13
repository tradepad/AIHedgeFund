import { describe, expect, it } from "vitest";
import { auditHash, toDomainEvent, type AuditInput } from "../src";
import type { outboxEvents } from "../src/schema";

const input: AuditInput = {
  organisationId: "0192b6a0-0000-7000-8000-000000000001",
  actorType: "USER",
  actorId: "0192b6a0-0000-7000-8000-000000000002",
  action: "DECISION_RECORDED",
  aggregateType: "STRATEGY_VERSION",
  aggregateId: "0192b6a0-0000-7000-8000-000000000003",
  priorState: { state: "PAPER_APPROVAL_REVIEW" },
  newState: { state: "PAPER_APPROVED" },
  reason: "committee decision",
  traceId: "trace-1",
};
const at = new Date("2026-01-01T00:00:00.000Z");

describe("audit hash chain", () => {
  it("is deterministic and independent of key order", () => {
    const reordered: AuditInput = { ...input, newState: { state: "PAPER_APPROVED" }, priorState: { state: "PAPER_APPROVAL_REVIEW" } };
    expect(auditHash(null, input, "id-1", at)).toBe(auditHash(null, reordered, "id-1", at));
    expect(auditHash(null, input, "id-1", at)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any recorded field or the previous link changes", () => {
    const h = auditHash("a".repeat(64), input, "id-1", at);
    expect(auditHash("b".repeat(64), input, "id-1", at)).not.toBe(h);
    expect(auditHash("a".repeat(64), { ...input, reason: "edited" }, "id-1", at)).not.toBe(h);
    expect(auditHash("a".repeat(64), input, "id-1", new Date(at.getTime() + 1))).not.toBe(h);
  });
});

describe("outbox rows", () => {
  const row: typeof outboxEvents.$inferSelect = {
    id: "0192b6a0-0000-7000-8000-000000000010",
    organisationId: input.organisationId,
    eventType: "parity.calculated",
    eventVersion: 1,
    aggregateType: "VERIFICATION",
    aggregateId: "0192b6a0-0000-7000-8000-000000000011",
    correlationId: "corr",
    causationId: null,
    actor: { type: "SERVICE", id: "service:worker-analytics" },
    payload: { verificationId: "0192b6a0-0000-7000-8000-000000000011" },
    traceId: "trace",
    createdAt: at,
    dispatchedAt: null,
    attempts: 0,
    lastError: null,
  };

  it("rebuild a contract-valid domain event", () => {
    const event = toDomainEvent(row);
    expect(event).toMatchObject({ eventId: row.id, eventType: "parity.calculated", aggregateType: "VERIFICATION" });
    expect(event.occurredAt).toMatch(/^2026-01-01T00:00:00(\.000)?Z$/);
  });

  it("refuse a row whose actor does not match the contract", () => {
    expect(() => toDomainEvent({ ...row, actor: { type: "ROBOT" } })).toThrow();
  });
});

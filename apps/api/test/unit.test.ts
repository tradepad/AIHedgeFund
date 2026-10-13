import { describe, expect, it } from "vitest";
import type { EvidenceSnapshot } from "@arf/contracts";
import { ConfigSchema } from "../src/config";
import { ProblemError } from "../src/http/problem";
import { SeqCursor, decodeCursor, encodeCursor, page } from "../src/http/pagination";
import { overridableWarnings } from "../src/services/decisions";

const base = { DATABASE_URL: "postgres://x/y", REDIS_URL: "redis://x", LOCAL_STORAGE_SIGNING_SECRET: "0123456789abcdef0123456789abcdef", LOCAL_STORAGE_DIR: "/var/lib/arf/objects" };

describe("configuration", () => {
  it("accepts the local development defaults", () => {
    const c = ConfigSchema.parse(base);
    expect(c.AUTH_MODE).toBe("dev");
    expect(c.RATE_LIMIT_MAX).toBe(30);
  });

  it("refuses development auth and local storage in production", () => {
    const r = ConfigSchema.safeParse({ ...base, NODE_ENV: "production" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join("."))).toEqual(expect.arrayContaining(["AUTH_MODE", "STORAGE_DRIVER"]));
  });

  it("requires an absolute local storage directory shared by every process", () => {
    expect(ConfigSchema.safeParse({ ...base, LOCAL_STORAGE_DIR: ".data/objects" }).success).toBe(false);
  });

  it("requires a signing secret for the local object store and S3 credentials for s3", () => {
    expect(ConfigSchema.safeParse({ DATABASE_URL: "postgres://x/y", REDIS_URL: "redis://x" }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...base, STORAGE_DRIVER: "s3" }).success).toBe(false);
  });
});

describe("cursor pagination", () => {
  it("round-trips cursors and emits a next cursor only when more rows exist", () => {
    const rows = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
    const p = page(rows, 2, (r) => ({ seq: r.seq }));
    expect(p.items).toHaveLength(2);
    expect(decodeCursor(SeqCursor, p.nextCursor ?? undefined)).toEqual({ seq: 2 });
    expect(page(rows, 3, (r) => ({ seq: r.seq })).nextCursor).toBeNull();
  });

  it("rejects malformed cursors with a typed problem", () => {
    expect(() => decodeCursor(SeqCursor, "%%%")).toThrow(ProblemError);
    expect(() => decodeCursor(SeqCursor, encodeCursor({ seq: "x" }))).toThrow(ProblemError);
  });
});

describe("decision overrides", () => {
  const evidence: EvidenceSnapshot = {
    strategyVersionId: "0192b6a0-0000-7000-8000-000000000001",
    state: "PAPER_APPROVAL_REVIEW",
    definitionHash: null,
    pineSourceHash: null,
    manifestHash: null,
    verificationId: null,
    backtestRunId: null,
    parityReportId: null,
    parityStatus: "WARN",
    closedTradeCount: 12,
    hardFailures: ["PARITY_FAIL"],
    warnings: ["PARITY_WARN", "LOW_TRADE_COUNT", "SOMETHING_ELSE"],
    missingEvidence: [],
  };

  it("lists only warnings a human may override; hard failures are never overridable", () => {
    expect(overridableWarnings(evidence)).toEqual(["PARITY_WARN", "LOW_TRADE_COUNT"]);
  });
});

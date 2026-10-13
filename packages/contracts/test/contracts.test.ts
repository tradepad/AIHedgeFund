import { describe, expect, it } from "vitest";
import {
  CreateDecisionRequestSchema,
  DecimalStringSchema,
  HandoffSchema,
  IdeaCardSchema,
  PineManifestSchema,
  SignalEventSchema,
  UtcTimestampSchema,
  CreateReportUploadRequestSchema,
  CreateStrategyVersionRequestSchema,
  exampleHandoff,
  exampleIdeaCard,
  examplePineManifest,
  exampleSignalEvent,
} from "../src";

describe("examples validate against their schemas", () => {
  it.each([
    ["idea card", IdeaCardSchema, exampleIdeaCard],
    ["handoff", HandoffSchema, exampleHandoff],
    ["signal event", SignalEventSchema, exampleSignalEvent],
    ["pine manifest", PineManifestSchema, examplePineManifest],
  ] as const)("%s", (_name, schema, example) => {
    expect(schema.safeParse(example).success).toBe(true);
  });
});

describe("primitive contracts", () => {
  it("accepts plain decimals and rejects floats-as-numbers, exponents and separators", () => {
    expect(DecimalStringSchema.safeParse("1234.50").success).toBe(true);
    expect(DecimalStringSchema.safeParse("-0.0001").success).toBe(true);
    expect(DecimalStringSchema.safeParse("1e5").success).toBe(false);
    expect(DecimalStringSchema.safeParse("1,234.50").success).toBe(false);
    expect(DecimalStringSchema.safeParse(12.5).success).toBe(false);
    expect(DecimalStringSchema.safeParse("01.5").success).toBe(false);
  });

  it("requires UTC timestamps at API boundaries", () => {
    expect(UtcTimestampSchema.safeParse("2026-10-13T07:00:00Z").success).toBe(true);
    expect(UtcTimestampSchema.safeParse("2026-10-13T07:00:00+02:00").success).toBe(false);
    expect(UtcTimestampSchema.safeParse("2026-10-13").success).toBe(false);
  });
});

describe("command contracts", () => {
  const base = {
    strategyVersionId: "0192f1a0-0000-7000-8000-000000000001",
    decision: "PAPER_APPROVED",
    reasonCodes: ["EVIDENCE_SUFFICIENT"],
    summary: "Parity passed and metrics within policy.",
    rejectionCase: "Sample of 120 trades is modest and from one regime.",
    parityReportId: null,
    acknowledgement: true,
  };

  it("requires an override reason when a human override is declared", () => {
    expect(CreateDecisionRequestSchema.safeParse({ ...base, humanOverride: true }).success).toBe(false);
    expect(
      CreateDecisionRequestSchema.safeParse({ ...base, humanOverride: true, overrideReason: "Accepted known data gap." })
        .success,
    ).toBe(true);
  });

  it("requires an explicit acknowledgement", () => {
    expect(CreateDecisionRequestSchema.safeParse({ ...base, acknowledgement: false }).success).toBe(false);
  });

  it("rejects decision values outside the allowed enum", () => {
    expect(CreateDecisionRequestSchema.safeParse({ ...base, decision: "LIVE_APPROVED" }).success).toBe(false);
  });

  it("requires explicit change description for child versions", () => {
    const child = {
      kind: "CHILD",
      parentVersionId: "0192f1a0-0000-7000-8000-000000000001",
      symbol: "BYBIT:BTCUSDT.P",
      timeframe: "60",
      changeReason: "Widen stop after parity review",
      changeCategories: [],
      changedFields: ["risk.stopLoss"],
      motivatingEvidenceIds: [],
      contaminatedData: [],
    };
    expect(CreateStrategyVersionRequestSchema.safeParse(child).success).toBe(false);
    expect(CreateStrategyVersionRequestSchema.safeParse({ ...child, changeCategories: ["PARAMETERS"] }).success).toBe(
      true,
    );
  });

  it("only accepts CSV uploads within the size limit", () => {
    const upload = {
      reportType: "LIST_OF_TRADES",
      fileName: "trades.csv",
      contentType: "text/csv",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    };
    expect(CreateReportUploadRequestSchema.safeParse(upload).success).toBe(true);
    expect(CreateReportUploadRequestSchema.safeParse({ ...upload, fileName: "trades.xlsx" }).success).toBe(false);
    expect(CreateReportUploadRequestSchema.safeParse({ ...upload, fileName: "../x.csv" }).success).toBe(false);
    expect(CreateReportUploadRequestSchema.safeParse({ ...upload, sizeBytes: 50 * 1024 * 1024 }).success).toBe(false);
  });
});

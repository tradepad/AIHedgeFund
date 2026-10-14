import { describe, expect, it } from "vitest";
import { ExternalImportBundleSchema, ExternalResultInputSchema } from "../src";

const NULL_METRICS = {
  closedTradeCount: null,
  profitFactor: null,
  maxDrawdownPct: null,
  netProfitPct: null,
  netProfit: null,
  largestWin: null,
  currency: null,
};

const result = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  engine: "TRADER_DEV",
  engineVersion: null,
  provenance: "OUR_RUN",
  segment: "IN_SAMPLE",
  runStatus: "COMPLETED",
  windowFrom: "2020-03-25",
  windowTo: "2024-12-31",
  externalResultId: null,
  metrics: { ...NULL_METRICS, closedTradeCount: 160, profitFactor: "1.57" },
  extraMetrics: {},
  settings: {},
  verdict: "PASS",
  verdictReasons: [],
  notes: [],
  ...extra,
});

const version = (key: string, change: unknown = null, results = [result(`${key}/is`)]) => ({
  key,
  symbol: "BYBIT:BTCUSDT.P",
  timeframe: "60",
  description: "a strategy",
  change,
  externalStrategyId: null,
  source: null,
  results,
});

const bundle = (versions: unknown[], name = "Strategy A") => ({
  schemaVersion: "1.0.0",
  batchId: "batch-1",
  title: "Batch",
  description: "A test import bundle.",
  campaigns: [
    {
      name: "Campaign",
      objective: "Test the import contract.",
      assetClasses: ["crypto"],
      timeframes: ["60"],
      strategies: [{ name, family: "trend_following", versions }],
    },
  ],
});

describe("external import bundle contract", () => {
  it("accepts a root version followed by a declared child", () => {
    const parsed = ExternalImportBundleSchema.safeParse(
      bundle([
        version("batch-1/a/v1"),
        version("batch-1/a/v2", { categories: ["PARAMETERS"], fields: ["length"] }),
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it("requires every later version to state its change, and the root not to", () => {
    expect(
      ExternalImportBundleSchema.safeParse(
        bundle([version("batch-1/a/v1"), version("batch-1/a/v2")]),
      ).success,
    ).toBe(false);
    expect(
      ExternalImportBundleSchema.safeParse(
        bundle([version("batch-1/a/v1", { categories: ["PARAMETERS"], fields: ["x"] })]),
      ).success,
    ).toBe(false);
  });

  it("rejects duplicate import keys anywhere in the bundle", () => {
    const parsed = ExternalImportBundleSchema.safeParse(
      bundle([version("batch-1/a/v1", null, [result("batch-1/dup"), result("batch-1/dup")])]),
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses metrics on a run that never happened and requires a reason", () => {
    const notRun = {
      runStatus: "NOT_RUN",
      windowFrom: null,
      windowTo: null,
      verdict: "NOT_EVALUATED",
    };
    expect(ExternalResultInputSchema.safeParse(result("k/x", notRun)).success).toBe(false);
    expect(
      ExternalResultInputSchema.safeParse(
        result("k/x", { ...notRun, metrics: NULL_METRICS, notes: ["Pine v5"] }),
      ).success,
    ).toBe(true);
    expect(
      ExternalResultInputSchema.safeParse(result("k/x", { ...notRun, metrics: NULL_METRICS }))
        .success,
    ).toBe(false);
  });

  it("keeps money and percentages as exact decimal strings", () => {
    const bad = result("k/x", {
      metrics: { ...NULL_METRICS, profitFactor: 1.57 },
    });
    expect(ExternalResultInputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a window that ends before it starts", () => {
    expect(
      ExternalResultInputSchema.safeParse(
        result("k/x", { windowFrom: "2025-01-01", windowTo: "2024-01-01" }),
      ).success,
    ).toBe(false);
  });
});

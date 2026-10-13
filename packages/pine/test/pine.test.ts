import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleStrategyDefinition, examplePineManifest, type PineManifest } from "@arf/contracts";
import {
  TREND_PULLBACK_TEMPLATE,
  lintPine,
  manifestFromDefinition,
  pineManifestHash,
  pineSourceHash,
  renderTrendPullbackTemplate,
} from "../src";
import { repoRoot } from "./helpers";

const manifest = manifestFromDefinition(exampleStrategyDefinition, {
  strategyId: examplePineManifest.strategyId,
  strategyVersionId: examplePineManifest.strategyVersionId,
  campaignId: examplePineManifest.campaignId,
  parentVersionId: null,
  sdlHash: examplePineManifest.sdlHash,
  symbol: "BYBIT:BTCUSDT.P",
  timeframe: "60",
  initialCapital: 10000,
  currency: "USDT",
});
const render = (m: PineManifest = manifest): string => {
  const r = renderTrendPullbackTemplate(exampleStrategyDefinition, m);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
};
const errors = (source: string, m: PineManifest = manifest) =>
  lintPine(source, m).findings.filter((f) => f.severity === "ERROR").map((f) => f.rule);

describe("hashing", () => {
  it("normalises line endings but nothing else", () => {
    expect(pineSourceHash("a\r\nb")).toBe(pineSourceHash("a\nb"));
    expect(pineSourceHash("a \nb")).not.toBe(pineSourceHash("a\nb"));
  });

  it("hashes manifests independent of key order", () => {
    const reordered = Object.fromEntries(Object.entries(manifest).reverse()) as PineManifest;
    expect(pineManifestHash(reordered)).toBe(pineManifestHash(manifest));
    expect(pineManifestHash({ ...manifest, timeframe: "240" })).not.toBe(pineManifestHash(manifest));
  });
});

describe("approved template (golden)", () => {
  it("is identical to the checked-in boilerplate", () => {
    const file = readFileSync(join(repoRoot, "pine", "boilerplate", "arf_trend_pullback.template.pine"), "utf8");
    expect(file).toBe(TREND_PULLBACK_TEMPLATE);
  });

  it("renders the golden fixture byte for byte", () => {
    const golden = readFileSync(join(repoRoot, "pine", "fixtures", "golden", "trend_pullback.pine"), "utf8");
    const goldenManifest = JSON.parse(readFileSync(join(repoRoot, "pine", "fixtures", "golden", "trend_pullback.manifest.json"), "utf8")) as PineManifest;
    expect(goldenManifest).toEqual(manifest);
    expect(render()).toBe(golden);
  });

  it("passes lint with no hard errors", () => {
    const result = lintPine(render(), manifest);
    expect(result.findings.filter((f) => f.severity === "ERROR")).toEqual([]);
    expect(result.status).toBe("WARN");
    expect(result.findings.map((f) => f.rule)).toContain("SAME_BAR_STOP_TARGET");
  });

  it("derives margin from leverage and maps the cost model", () => {
    expect(manifest.properties.marginLongPct).toBe(33.33);
    expect(manifest.properties.commissionType).toBe("strategy.commission.percent");
    expect(manifest.properties.slippageTicks).toBe(2);
  });
});

describe("lint hard errors", () => {
  it.each([
    ["PINE_VERSION", (s: string) => s.replace("//@version=6", "//@version=5")],
    ["FUTURE_REFERENCE", (s: string) => s.replace("fast = ta.ema(close, fast_length)", "fast = ta.ema(close[-1], fast_length)")],
    ["NEGATIVE_OFFSET", (s: string) => s.replace('plot(fast, "Fast EMA"', 'plot(fast, "Fast EMA", offset = -2')],
    ["UNSAFE_LOOKAHEAD", (s: string) => s.replace("close[1], lookahead", "close, lookahead")],
    ["UNCONFIRMED_MTF", (s: string) => s.replace(", lookahead = barmerge.lookahead_on)", ")")],
    ["MISSING_COST_MODEL", (s: string) => s.replace(", slippage = 2", "")],
    ["UNDECLARED_PYRAMIDING", (s: string) => s.replace(", pyramiding = 0", "")],
    ["UNDECLARED_CALC_ON_EVERY_TICK", (s: string) => s.replace(", calc_on_every_tick = false", "")],
    ["SOURCE_MANIFEST_MISMATCH", (s: string) => s.replace("commission_value = 0.06", "commission_value = 0.01")],
    ["UNBOUNDED_INPUT", (s: string) => s.replace(', "Fast EMA", minval = 10, maxval = 50', ', "Fast EMA"')],
    ["UNDECLARED_INPUT", (s: string) => s.replace("deployment_id = input.string", 'extra_len = input.int(5, "x", minval = 1, maxval = 9)\ndeployment_id = input.string')],
    ["MISSING_DATE_WINDOW", (s: string) => s.replace(/start_date = input\.time\([^\n]+\n/, "start_date = 0\n")],
    ["MISSING_ALERT_FIELDS", (s: string) => s.replace(/"deploymentId"/g, '"deployment"')],
    ["MISSING_SDL_IDENTITY", (s: string) => s.replace(/\/\/ SDL Hash: \w+/, "// SDL Hash: deadbeef")],
    ["MISSING_STRATEGY_DECLARATION", (s: string) => s.replace("strategy(\"", "indicator(\"")],
    ["UNSTABLE_ORDER_ID", (s: string) => s.replace('strategy.entry("L"', "strategy.entry(order_id")],
  ])("flags %s", (rule, mutate) => {
    expect(errors(mutate(render()))).toContain(rule);
  });

  it("ignores patterns inside comments", () => {
    const s = render().replace("// ---- Diagnostics", "// close[-1] and offset = -3 are only mentioned here\n// ---- Diagnostics");
    expect(errors(s)).toEqual([]);
  });

  it("flags non-standard chart types as a warning", () => {
    const s = render().replace("syminfo.tickerid", "ticker.heikinashi(syminfo.tickerid)");
    const result = lintPine(s, manifest);
    expect(result.findings.some((f) => f.rule === "NON_STANDARD_CHART" && f.severity === "WARNING")).toBe(true);
  });
});

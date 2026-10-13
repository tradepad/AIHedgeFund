import { describe, expect, it } from "vitest";
import { D, computeCoreMetrics, reconstructEquity, recomputeTrade, type CostModel, type LedgerTradeInput, type MetricValue } from "../src";

const costs: CostModel = { commissionType: "percent", commissionValue: "0.1" };
const ledger: LedgerTradeInput[] = [
  { tradeNumber: 1, direction: "LONG", entryTime: "2024-01-01T00:00:00Z", exitTime: "2024-01-01T10:00:00Z", entryPrice: "100", exitPrice: "110", quantity: "2", reportedNetPnl: "19.58" },
  { tradeNumber: 2, direction: "SHORT", entryTime: "2024-01-15T00:00:00Z", exitTime: "2024-01-16T00:00:00Z", entryPrice: "50", exitPrice: "55", quantity: "4", reportedNetPnl: "-20.42" },
  { tradeNumber: 3, direction: "LONG", entryTime: "2024-02-10T00:00:00Z", exitTime: "2024-02-10T12:00:00Z", entryPrice: "10", exitPrice: "9", quantity: "10", reportedNetPnl: "-10.19" },
  { tradeNumber: 4, direction: "SHORT", entryTime: "2024-04-01T00:00:00Z", exitTime: "2024-04-02T00:00:00Z", entryPrice: "20", exitPrice: "15", quantity: "5", reportedNetPnl: "24.83" },
];
const trades = ledger.map((t) => recomputeTrade(t, costs));
const curve = reconstructEquity("1000", trades);
const metrics = computeCoreMetrics({ initialCapital: "1000", trades, drawdown: curve.drawdown });
const m = (name: MetricValue["name"], period = "") => metrics.find((x) => x.name === name && x.periodKey === period);
const ratio = (a: string, b: string) => new D(a).div(b).toDecimalPlaces(12).toFixed();

describe("trade recomputation (hand-calculated)", () => {
  it("computes gross, commission and net per trade for long and short", () => {
    expect(trades.map((t) => [t.calcGrossPnl, t.calcCommission, t.calcNetPnl])).toEqual([
      ["20", "0.42", "19.58"],
      ["-20", "0.42", "-20.42"],
      ["-10", "0.19", "-10.19"],
      ["25", "0.175", "24.825"],
    ]);
    expect(trades.map((t) => t.holdingSeconds)).toEqual([36000, 86400, 43200, 86400]);
  });

  it("supports cash commission models", () => {
    const t = ledger[0];
    if (!t) throw new Error("fixture");
    expect(recomputeTrade(t, { commissionType: "cash_per_order", commissionValue: "1.5" }).calcNetPnl).toBe("17");
    expect(recomputeTrade(t, { commissionType: "cash_per_contract", commissionValue: "0.5" }).calcNetPnl).toBe("18");
  });

  it("does not lose precision to binary floating point", () => {
    const t = recomputeTrade(
      { tradeNumber: 1, direction: "LONG", entryTime: "2024-01-01T00:00:00Z", exitTime: "2024-01-01T00:00:00Z", entryPrice: "0.1", exitPrice: "0.3", quantity: "3", reportedNetPnl: null },
      { commissionType: "percent", commissionValue: "0" },
    );
    expect(t.calcNetPnl).toBe("0.6");
  });
});

describe("equity and drawdown reconstruction", () => {
  it("starts at initial capital at the first entry and steps at each exit", () => {
    expect(curve.equity.map((p) => [p.time, p.equity, p.tradeNumber])).toEqual([
      ["2024-01-01T00:00:00Z", "1000", null],
      ["2024-01-01T10:00:00Z", "1019.58", 1],
      ["2024-01-16T00:00:00Z", "999.16", 2],
      ["2024-02-10T12:00:00Z", "988.97", 3],
      ["2024-04-02T00:00:00Z", "1013.795", 4],
    ]);
  });

  it("tracks running peak drawdown in currency and percentage points", () => {
    expect(curve.drawdown.map((p) => p.drawdown)).toEqual(["0", "0", "20.42", "30.61", "5.785"]);
    expect(curve.drawdown[3]?.drawdownPct).toBe(new D("30.61").div("1019.58").times(100).toDecimalPlaces(12).toFixed());
  });

  it("orders by exit time even when input is unordered", () => {
    const shuffled = reconstructEquity("1000", [...trades].reverse());
    expect(shuffled.equity).toEqual(curve.equity);
  });

  it("returns empty series for an empty ledger and rejects non-positive capital", () => {
    expect(reconstructEquity("1000", [])).toEqual({ equity: [], drawdown: [] });
    expect(() => reconstructEquity("0", trades)).toThrow();
  });
});

describe("core metrics (hand-calculated)", () => {
  it.each([
    ["closed_trade_count", "4", "COUNT"],
    ["gross_profit", "44.405", "CURRENCY"],
    ["gross_loss", "30.61", "CURRENCY"],
    ["net_profit", "13.795", "CURRENCY"],
    ["commission_paid", "1.205", "CURRENCY"],
    ["win_rate_pct", "50", "PERCENT_POINTS"],
    ["average_win", "22.2025", "CURRENCY"],
    ["average_loss", "15.305", "CURRENCY"],
    ["longest_losing_streak", "2", "COUNT"],
    ["average_holding_seconds", "63000", "SECONDS"],
    ["max_drawdown", "30.61", "CURRENCY"],
    ["total_return_pct", "1.3795", "PERCENT_POINTS"],
    ["initial_capital", "1000", "CURRENCY"],
  ] as const)("%s = %s %s", (name, value, unit) => {
    expect(m(name)).toMatchObject({ status: "DEFINED", value, unit });
  });

  it("computes ratios exactly", () => {
    expect(m("profit_factor")?.value).toBe(ratio("44.405", "30.61"));
    expect(m("payoff_ratio")?.value).toBe(ratio("22.2025", "15.305"));
    expect(m("max_drawdown_pct")?.value).toBe(new D("30.61").div("1019.58").times(100).toDecimalPlaces(12).toFixed());
  });

  it("reports every month in range, including months without exits", () => {
    const monthly = metrics.filter((x) => x.name === "monthly_return_pct").map((x) => [x.periodKey, x.value]);
    expect(monthly).toEqual([
      ["2024-01", "-0.084"],
      ["2024-02", new D("-10.19").div("999.16").times(100).toDecimalPlaces(12).toFixed()],
      ["2024-03", "0"],
      ["2024-04", new D("24.825").div("988.97").times(100).toDecimalPlaces(12).toFixed()],
    ]);
  });

  it("marks undefined values explicitly instead of NaN or dropping them", () => {
    const allWins = computeCoreMetrics({ initialCapital: "1000", trades: trades.filter((t) => new D(t.calcNetPnl).gt(0)), drawdown: [] });
    expect(allWins.find((x) => x.name === "profit_factor")).toMatchObject({ status: "UNDEFINED", value: null, undefinedReason: "NO_LOSING_TRADES" });
    const none = computeCoreMetrics({ initialCapital: "1000", trades: [], drawdown: [] });
    expect(none.find((x) => x.name === "win_rate_pct")).toMatchObject({ status: "UNDEFINED", undefinedReason: "NO_CLOSED_TRADES" });
    expect(none.find((x) => x.name === "closed_trade_count")?.value).toBe("0");
    expect(none.every((x) => x.status === "UNDEFINED" || x.value !== null)).toBe(true);
    expect(JSON.stringify(none)).not.toContain("NaN");
  });
});

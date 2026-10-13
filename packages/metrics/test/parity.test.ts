import { describe, expect, it } from "vitest";
import { computeParity, type ParityInput } from "../src";

const hash = "a".repeat(64);
const trade = (n: number, calc: string, reported: string | null) => ({
  tradeNumber: n,
  entryTime: `2024-01-0${n}T00:00:00Z`,
  exitTime: `2024-01-0${n}T12:00:00Z`,
  entryPrice: "100",
  quantity: "1",
  reportedNetPnl: reported,
  calcNetPnl: calc,
});
const base = (): ParityInput => ({
  expected: { pineSourceHash: hash, currency: "USDT", initialCapital: "10000", windowStartUtc: "2024-01-01T00:00:00Z", windowEndUtc: "2024-02-01T00:00:00Z" },
  observed: {
    attestedPineSourceHashes: [hash, hash],
    reportCurrencies: ["USDT", "USDT"],
    reportedInitialCapital: "10000",
    reportedClosedTrades: "2",
    reportedNetProfit: "15",
    reportedMaxDrawdown: "5",
    arfNetProfit: "15.004",
    arfMaxDrawdown: "5",
  },
  trades: [trade(1, "10.004", "10"), trade(2, "5", "5")],
});

describe("parity", () => {
  it("passes when identity, count, sequence and aggregates agree", () => {
    const r = computeParity(base());
    expect(r.status).toBe("PASS");
    expect(r.firstDivergence).toBeNull();
    expect(r.policyVersion).toBe("arf-parity/1.0.0");
  });

  it("fails on a source hash mismatch and reports it as the first divergence", () => {
    const input = base();
    input.observed.attestedPineSourceHashes = [hash, "b".repeat(64)];
    input.observed.reportedClosedTrades = "3";
    const r = computeParity(input);
    expect(r.status).toBe("FAIL");
    expect(r.firstDivergence?.check).toBe("SOURCE_IDENTITY");
  });

  it("fails on trade count mismatch", () => {
    const input = base();
    input.observed.reportedClosedTrades = "3";
    expect(computeParity(input)).toMatchObject({ status: "FAIL", firstDivergence: { check: "TRADE_COUNT" } });
  });

  it("names the first trade whose P&L cannot be reproduced", () => {
    const input = base();
    input.trades = [trade(1, "10", "10"), trade(2, "7", "5")];
    const r = computeParity(input);
    expect(r.firstDivergence).toMatchObject({ check: "TRADE_PNL_SEQUENCE", status: "FAIL" });
    expect(r.firstDivergence?.detail).toContain("trade #2");
  });

  it("warns, not fails, when ARF closed-trade drawdown is below TradingView intrabar drawdown", () => {
    const input = base();
    input.observed.reportedMaxDrawdown = "8";
    expect(computeParity(input)).toMatchObject({ status: "WARN", firstDivergence: { check: "MAX_DRAWDOWN", status: "WARN" } });
  });

  it("fails when ARF drawdown exceeds TradingView's, which is impossible", () => {
    const input = base();
    input.observed.arfMaxDrawdown = "9";
    expect(computeParity(input).status).toBe("FAIL");
  });

  it("returns INSUFFICIENT_DATA when mandatory evidence is missing", () => {
    const input = base();
    input.observed.reportedNetProfit = null;
    expect(computeParity(input).status).toBe("INSUFFICIENT_DATA");
  });

  it("fails when trades fall outside the verification window", () => {
    const input = base();
    input.expected.windowStartUtc = "2024-01-02T00:00:00Z";
    expect(computeParity(input)).toMatchObject({ status: "FAIL", firstDivergence: { check: "FIRST_TRADE" } });
  });

  it("fails on currency or capital mismatch", () => {
    const input = base();
    input.observed.reportedInitialCapital = "5000";
    expect(computeParity(input)).toMatchObject({ status: "FAIL", firstDivergence: { check: "SETTINGS_IDENTITY" } });
  });

  it("classifies net profit differences by tolerance band", () => {
    const input = base();
    input.observed.reportedNetProfit = "1000";
    input.observed.arfNetProfit = "1005";
    expect(computeParity(input).checks.find((c) => c.check === "NET_PROFIT")?.status).toBe("WARN");
    input.observed.arfNetProfit = "1100";
    expect(computeParity(input).checks.find((c) => c.check === "NET_PROFIT")?.status).toBe("FAIL");
  });
});

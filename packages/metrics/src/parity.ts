import type { ParityCheck, ParityStatus } from "@arf/contracts";
import { D } from "./decimal";
import { sortByExit } from "./trades";

export const PARITY_POLICY_VERSION = "arf-parity/1.0.0";

/**
 * Tolerances for policy arf-parity/1.0.0.
 * - Per-trade net P&L: |ARF - TV| <= max(0.01, 0.05% of entry notional).
 *   Covers TradingView's per-trade rounding to cents.
 * - Net profit: PASS within max(0.01 * trades, 0.1% of |TV|); WARN within 1%.
 * - Max drawdown: ARF uses closed-trade equity, TradingView intrabar equity,
 *   so ARF <= TV is expected. PASS within 1%; WARN when ARF is lower;
 *   FAIL when ARF exceeds TV by more than 1% (impossible if both are right).
 */
export const PARITY_TOLERANCES = {
  tradePnlAbsolute: "0.01",
  tradePnlNotionalFraction: "0.0005",
  netProfitRelative: "0.001",
  netProfitWarnRelative: "0.01",
  drawdownRelative: "0.01",
} as const;

export interface ParityTrade {
  tradeNumber: number;
  entryTime: string;
  exitTime: string;
  entryPrice: string;
  quantity: string;
  reportedNetPnl: string | null;
  calcNetPnl: string;
}

export interface ParityInput {
  expected: {
    pineSourceHash: string;
    currency: string;
    initialCapital: string;
    /** Inclusive UTC instant of the start of the verification window. */
    windowStartUtc: string;
    /** Exclusive UTC instant of the end of the verification window. */
    windowEndUtc: string;
  };
  observed: {
    attestedPineSourceHashes: string[];
    reportCurrencies: string[];
    reportedInitialCapital: string | null;
    reportedClosedTrades: string | null;
    reportedNetProfit: string | null;
    reportedMaxDrawdown: string | null;
    arfNetProfit: string;
    arfMaxDrawdown: string;
  };
  trades: readonly ParityTrade[];
}

export interface ParityResult {
  policyVersion: string;
  status: ParityStatus;
  checks: ParityCheck[];
  firstDivergence: ParityCheck | null;
}

/** Order in which divergence is reported: identity first, then sequence, then aggregates. */
const DIVERGENCE_ORDER: ParityCheck["check"][] = [
  "SOURCE_IDENTITY",
  "SETTINGS_IDENTITY",
  "TRADE_COUNT",
  "FIRST_TRADE",
  "TRADE_PNL_SEQUENCE",
  "LAST_TRADE",
  "NET_PROFIT",
  "MAX_DRAWDOWN",
];
const MANDATORY: ParityCheck["check"][] = ["SOURCE_IDENTITY", "TRADE_COUNT", "NET_PROFIT"];

export function computeParity(input: ParityInput): ParityResult {
  const checks: ParityCheck[] = [];
  const { expected, observed } = input;
  const trades = sortByExit(input.trades);

  // 1. Source identity: every uploaded report must attest the exact Pine hash.
  const hashes = observed.attestedPineSourceHashes;
  checks.push(
    hashes.length === 0
      ? { check: "SOURCE_IDENTITY", status: "INSUFFICIENT_DATA", expected: expected.pineSourceHash, actual: null, tolerance: "exact", detail: "no upload attested a Pine source hash" }
      : hashes.every((h) => h === expected.pineSourceHash)
        ? { check: "SOURCE_IDENTITY", status: "PASS", expected: expected.pineSourceHash, actual: expected.pineSourceHash, tolerance: "exact", detail: "all uploads attest the verified Pine source" }
        : { check: "SOURCE_IDENTITY", status: "FAIL", expected: expected.pineSourceHash, actual: hashes.find((h) => h !== expected.pineSourceHash) ?? null, tolerance: "exact", detail: "an upload attests a different Pine source" },
  );

  // 2. Settings identity: currency and initial capital where the report states them.
  const currencyMismatch = observed.reportCurrencies.find((c) => c !== expected.currency);
  const capitalMismatch =
    observed.reportedInitialCapital !== null && !new D(observed.reportedInitialCapital).eq(expected.initialCapital);
  checks.push(
    currencyMismatch || capitalMismatch
      ? {
          check: "SETTINGS_IDENTITY",
          status: "FAIL",
          expected: `${expected.initialCapital} ${expected.currency}`,
          actual: `${observed.reportedInitialCapital ?? "?"} ${currencyMismatch ?? expected.currency}`,
          tolerance: "exact",
          detail: "report currency or initial capital differs from the verification settings",
        }
      : {
          check: "SETTINGS_IDENTITY",
          status: observed.reportedInitialCapital === null ? "WARN" : "PASS",
          expected: `${expected.initialCapital} ${expected.currency}`,
          actual: `${observed.reportedInitialCapital ?? "not reported"} ${expected.currency}`,
          tolerance: "exact",
          detail: observed.reportedInitialCapital === null ? "initial capital not in export; relying on operator attestation" : "currency and initial capital match",
        },
  );

  // 3. Trade count.
  const count = trades.length;
  checks.push(
    observed.reportedClosedTrades === null
      ? { check: "TRADE_COUNT", status: "INSUFFICIENT_DATA", expected: null, actual: String(count), tolerance: "exact", detail: "summary does not report closed trades" }
      : {
          check: "TRADE_COUNT",
          status: new D(observed.reportedClosedTrades).eq(count) ? "PASS" : "FAIL",
          expected: observed.reportedClosedTrades,
          actual: String(count),
          tolerance: "exact",
          detail: "TradingView closed-trade count vs parsed trade ledger",
        },
  );

  // 4. First and last trade fall inside the declared window.
  const first = trades.reduce<ParityTrade | null>((m, t) => (m === null || t.entryTime < m.entryTime ? t : m), null);
  const last = trades.at(-1) ?? null;
  checks.push(
    first === null
      ? { check: "FIRST_TRADE", status: "INSUFFICIENT_DATA", expected: expected.windowStartUtc, actual: null, tolerance: "inside window", detail: "no closed trades" }
      : {
          check: "FIRST_TRADE",
          status: first.entryTime >= expected.windowStartUtc ? "PASS" : "FAIL",
          expected: `>= ${expected.windowStartUtc}`,
          actual: `#${first.tradeNumber} entry ${first.entryTime}`,
          tolerance: "inside window",
          detail: "first trade entry relative to the verification date range",
        },
  );

  // 5. Per-trade P&L sequence; report the first divergent trade.
  if (trades.length === 0 || trades.some((t) => t.reportedNetPnl === null)) {
    checks.push({ check: "TRADE_PNL_SEQUENCE", status: "INSUFFICIENT_DATA", expected: null, actual: null, tolerance: null, detail: "per-trade P&L not reported for every trade" });
  } else {
    const divergent = trades.find((t) => {
      const tol = D.max(new D(PARITY_TOLERANCES.tradePnlAbsolute), new D(t.entryPrice).times(t.quantity).times(PARITY_TOLERANCES.tradePnlNotionalFraction));
      return new D(t.calcNetPnl).minus(t.reportedNetPnl ?? "0").abs().gt(tol);
    });
    checks.push(
      divergent
        ? {
            check: "TRADE_PNL_SEQUENCE",
            status: "FAIL",
            expected: divergent.reportedNetPnl,
            actual: new D(divergent.calcNetPnl).toDecimalPlaces(4).toFixed(),
            tolerance: `max(${PARITY_TOLERANCES.tradePnlAbsolute}, ${PARITY_TOLERANCES.tradePnlNotionalFraction} x notional)`,
            detail: `trade #${divergent.tradeNumber} (exit ${divergent.exitTime}) net P&L cannot be reproduced from prices and declared costs`,
          }
        : {
            check: "TRADE_PNL_SEQUENCE",
            status: "PASS",
            expected: `${trades.length} trades`,
            actual: `${trades.length} trades`,
            tolerance: `max(${PARITY_TOLERANCES.tradePnlAbsolute}, ${PARITY_TOLERANCES.tradePnlNotionalFraction} x notional)`,
            detail: "every trade's net P&L reproduces from prices, quantity and declared costs",
          },
    );
  }

  checks.push(
    last === null
      ? { check: "LAST_TRADE", status: "INSUFFICIENT_DATA", expected: expected.windowEndUtc, actual: null, tolerance: "inside window", detail: "no closed trades" }
      : {
          check: "LAST_TRADE",
          status: last.exitTime < expected.windowEndUtc ? "PASS" : "FAIL",
          expected: `< ${expected.windowEndUtc}`,
          actual: `#${last.tradeNumber} exit ${last.exitTime}`,
          tolerance: "inside window",
          detail: "last trade exit relative to the verification date range",
        },
  );

  // 6. Net profit.
  if (observed.reportedNetProfit === null) {
    checks.push({ check: "NET_PROFIT", status: "INSUFFICIENT_DATA", expected: null, actual: observed.arfNetProfit, tolerance: null, detail: "summary does not report net profit" });
  } else {
    const tv = new D(observed.reportedNetProfit);
    const diff = new D(observed.arfNetProfit).minus(tv).abs();
    const passTol = D.max(new D(PARITY_TOLERANCES.tradePnlAbsolute).times(Math.max(count, 1)), tv.abs().times(PARITY_TOLERANCES.netProfitRelative));
    const warnTol = D.max(passTol, tv.abs().times(PARITY_TOLERANCES.netProfitWarnRelative));
    checks.push({
      check: "NET_PROFIT",
      status: diff.lte(passTol) ? "PASS" : diff.lte(warnTol) ? "WARN" : "FAIL",
      expected: tv.toFixed(),
      actual: new D(observed.arfNetProfit).toDecimalPlaces(4).toFixed(),
      tolerance: `pass <= ${passTol.toDecimalPlaces(4).toFixed()}, warn <= ${warnTol.toDecimalPlaces(4).toFixed()}`,
      detail: "TradingView-reported net profit vs ARF recomputation from the trade ledger",
    });
  }

  // 7. Max drawdown (different bases; see tolerances).
  if (observed.reportedMaxDrawdown === null) {
    checks.push({ check: "MAX_DRAWDOWN", status: "INSUFFICIENT_DATA", expected: null, actual: observed.arfMaxDrawdown, tolerance: null, detail: "summary does not report max drawdown" });
  } else {
    const tv = new D(observed.reportedMaxDrawdown).abs();
    const arf = new D(observed.arfMaxDrawdown);
    const tol = tv.times(PARITY_TOLERANCES.drawdownRelative);
    const status: ParityStatus = arf.minus(tv).abs().lte(tol) ? "PASS" : arf.lt(tv) ? "WARN" : "FAIL";
    checks.push({
      check: "MAX_DRAWDOWN",
      status,
      expected: tv.toFixed(),
      actual: arf.toDecimalPlaces(4).toFixed(),
      tolerance: `±${PARITY_TOLERANCES.drawdownRelative} relative; ARF closed-trade basis <= TradingView intrabar basis`,
      detail:
        status === "WARN"
          ? "ARF closed-trade drawdown is below TradingView's intrabar drawdown, as expected for different bases"
          : status === "FAIL"
            ? "ARF closed-trade drawdown exceeds TradingView's intrabar drawdown, which should be impossible"
            : "drawdowns agree",
    });
  }

  const ordered = DIVERGENCE_ORDER.flatMap((name) => checks.filter((c) => c.check === name));
  const firstDivergence = ordered.find((c) => c.status !== "PASS") ?? null;
  const status: ParityStatus = ordered.some((c) => c.status === "FAIL")
    ? "FAIL"
    : ordered.some((c) => MANDATORY.includes(c.check) && c.status === "INSUFFICIENT_DATA")
      ? "INSUFFICIENT_DATA"
      : ordered.some((c) => c.status !== "PASS")
        ? "WARN"
        : "PASS";
  return { policyVersion: PARITY_POLICY_VERSION, status, checks: ordered, firstDivergence };
}

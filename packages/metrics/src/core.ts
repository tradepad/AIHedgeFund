import type { DrawdownPoint, MetricName, MetricUnit } from "@arf/contracts";
import { D, toStorage, type Dec } from "./decimal";
import { sortByExit } from "./trades";

export const METRICS_CALCULATION_VERSION = "arf-metrics/1.0.0";

export interface MetricValue {
  name: MetricName;
  /** `YYYY-MM` for monthly values, empty for whole-scope values. */
  periodKey: string;
  unit: MetricUnit;
  status: "DEFINED" | "UNDEFINED";
  value: string | null;
  undefinedReason: string | null;
}

export interface MetricTradeInput {
  tradeNumber: number;
  entryTime: string;
  exitTime: string;
  calcNetPnl: string;
  calcCommission: string;
  holdingSeconds: number;
}

const defined = (name: MetricName, unit: MetricUnit, value: Dec, periodKey = ""): MetricValue => ({
  name,
  periodKey,
  unit,
  status: "DEFINED",
  value: toStorage(value),
  undefinedReason: null,
});

const undefinedMetric = (name: MetricName, unit: MetricUnit, reason: string, periodKey = ""): MetricValue => ({
  name,
  periodKey,
  unit,
  status: "UNDEFINED",
  value: null,
  undefinedReason: reason,
});

/**
 * Core closed-trade metrics (spec §12.5 subset). Definitions:
 * - winner: net P&L > 0; loser: net P&L < 0; break-even trades count toward
 *   trade count but neither wins nor losses.
 * - gross profit / gross loss: sums of net P&L of winners / |net P&L| of losers.
 * - max drawdown: closed-trade equity, peak to trough (currency and percent are
 *   maximised independently and may come from different troughs).
 * - monthly return: net P&L of trades exiting in the UTC calendar month divided
 *   by closed-trade equity at the start of that month. Months without exits
 *   are reported as 0, never dropped.
 * Undefined values (division by zero, no trades) are explicit, never NaN.
 */
export function computeCoreMetrics(input: {
  initialCapital: string;
  trades: readonly MetricTradeInput[];
  drawdown: readonly DrawdownPoint[];
}): MetricValue[] {
  const capital = new D(input.initialCapital);
  const trades = sortByExit(input.trades);
  const out: MetricValue[] = [];
  const n = trades.length;
  out.push(defined("initial_capital", "CURRENCY", capital));
  out.push(defined("closed_trade_count", "COUNT", new D(n)));

  const nets = trades.map((t) => new D(t.calcNetPnl));
  const winners = nets.filter((x) => x.gt(0));
  const losers = nets.filter((x) => x.lt(0));
  const grossProfit = winners.reduce((a, b) => a.plus(b), new D(0));
  const grossLoss = losers.reduce((a, b) => a.plus(b.abs()), new D(0));
  const net = nets.reduce((a, b) => a.plus(b), new D(0));
  const commission = trades.reduce((a, t) => a.plus(t.calcCommission), new D(0));

  out.push(defined("gross_profit", "CURRENCY", grossProfit));
  out.push(defined("gross_loss", "CURRENCY", grossLoss));
  out.push(defined("net_profit", "CURRENCY", net));
  out.push(defined("commission_paid", "CURRENCY", commission));
  out.push(defined("total_return_pct", "PERCENT_POINTS", net.div(capital).times(100)));

  if (n === 0) {
    for (const [name, unit] of [
      ["profit_factor", "RATIO"],
      ["win_rate_pct", "PERCENT_POINTS"],
      ["average_win", "CURRENCY"],
      ["average_loss", "CURRENCY"],
      ["payoff_ratio", "RATIO"],
      ["average_holding_seconds", "SECONDS"],
    ] as const) {
      out.push(undefinedMetric(name, unit, "NO_CLOSED_TRADES"));
    }
  } else {
    out.push(grossLoss.isZero() ? undefinedMetric("profit_factor", "RATIO", "NO_LOSING_TRADES") : defined("profit_factor", "RATIO", grossProfit.div(grossLoss)));
    out.push(defined("win_rate_pct", "PERCENT_POINTS", new D(winners.length).div(n).times(100)));
    const avgWin = winners.length > 0 ? grossProfit.div(winners.length) : null;
    const avgLoss = losers.length > 0 ? grossLoss.div(losers.length) : null;
    out.push(avgWin ? defined("average_win", "CURRENCY", avgWin) : undefinedMetric("average_win", "CURRENCY", "NO_WINNING_TRADES"));
    out.push(avgLoss ? defined("average_loss", "CURRENCY", avgLoss) : undefinedMetric("average_loss", "CURRENCY", "NO_LOSING_TRADES"));
    out.push(
      avgWin && avgLoss
        ? defined("payoff_ratio", "RATIO", avgWin.div(avgLoss))
        : undefinedMetric("payoff_ratio", "RATIO", avgWin ? "NO_LOSING_TRADES" : "NO_WINNING_TRADES"),
    );
    const holding = trades.reduce((a, t) => a.plus(t.holdingSeconds), new D(0));
    out.push(defined("average_holding_seconds", "SECONDS", holding.div(n)));
  }

  let streak = 0;
  let longest = 0;
  for (const x of nets) {
    streak = x.lt(0) ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  out.push(defined("longest_losing_streak", "COUNT", new D(longest)));

  let maxDd = new D(0);
  let maxDdPct = new D(0);
  for (const p of input.drawdown) {
    if (new D(p.drawdown).gt(maxDd)) maxDd = new D(p.drawdown);
    if (new D(p.drawdownPct).gt(maxDdPct)) maxDdPct = new D(p.drawdownPct);
  }
  out.push(defined("max_drawdown", "CURRENCY", maxDd));
  out.push(defined("max_drawdown_pct", "PERCENT_POINTS", maxDdPct));

  out.push(...monthlyReturns(capital, trades));
  return out;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const year = y ?? 0;
  const month = m ?? 1;
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthlyReturns(capital: Dec, trades: readonly MetricTradeInput[]): MetricValue[] {
  if (trades.length === 0) return [];
  const firstEntry = trades.reduce((m, t) => (t.entryTime < m ? t.entryTime : m), trades[0]?.entryTime ?? "");
  const lastExit = trades.reduce((m, t) => (t.exitTime > m ? t.exitTime : m), "");
  const out: MetricValue[] = [];
  let equity = capital;
  for (let key = monthKey(firstEntry); key <= monthKey(lastExit); key = nextMonth(key)) {
    const pnl = trades.filter((t) => monthKey(t.exitTime) === key).reduce((a, t) => a.plus(t.calcNetPnl), new D(0));
    out.push(
      equity.lte(0)
        ? undefinedMetric("monthly_return_pct", "PERCENT_POINTS", "NON_POSITIVE_START_EQUITY", key)
        : defined("monthly_return_pct", "PERCENT_POINTS", pnl.div(equity).times(100), key),
    );
    equity = equity.plus(pnl);
  }
  return out;
}

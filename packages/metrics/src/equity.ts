import type { DrawdownPoint, EquityPoint } from "@arf/contracts";
import { D, toStorage } from "./decimal";
import { sortByExit } from "./trades";

export const EQUITY_CALCULATION_VERSION = "arf-equity/1.0.0";

export interface EquityTradeInput {
  tradeNumber: number;
  entryTime: string;
  exitTime: string;
  calcNetPnl: string;
}

/**
 * Closed-trade equity curve: one point at the first entry with the declared
 * initial capital, then one point per closed trade. Open-trade (intrabar)
 * excursions are not observable from the trade list, so this drawdown is a
 * lower bound on TradingView's intrabar drawdown.
 */
export function reconstructEquity(initialCapital: string, trades: readonly EquityTradeInput[]): { equity: EquityPoint[]; drawdown: DrawdownPoint[] } {
  const ordered = sortByExit(trades);
  const first = ordered.reduce<string | null>((min, t) => (min === null || t.entryTime < min ? t.entryTime : min), null);
  const capital = new D(initialCapital);
  if (capital.lte(0)) throw new Error("initial capital must be positive");
  const equity: EquityPoint[] = [];
  const drawdown: DrawdownPoint[] = [];
  let running = capital;
  let peak = capital;
  const push = (time: string, tradeNumber: number | null) => {
    const seq = equity.length;
    if (running.gt(peak)) peak = running;
    const dd = peak.minus(running);
    equity.push({ seq, time, equity: toStorage(running), tradeNumber });
    drawdown.push({
      seq,
      time,
      peakEquity: toStorage(peak),
      drawdown: toStorage(dd),
      drawdownPct: toStorage(peak.isZero() ? new D(0) : dd.div(peak).times(100)),
    });
  };
  if (first !== null) push(first, null);
  for (const t of ordered) {
    running = running.plus(t.calcNetPnl);
    push(t.exitTime, t.tradeNumber);
  }
  return { equity, drawdown };
}

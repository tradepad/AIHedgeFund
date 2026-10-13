import type { TradeDirection } from "@arf/contracts";
import { D, toStorage, type Dec } from "./decimal";

export const TRADE_RECOMPUTE_VERSION = "arf-trade-pnl/1.0.0";

export interface CostModel {
  commissionType: "percent" | "cash_per_order" | "cash_per_contract";
  /** Percentage points per side for `percent`; cash per order or per contract otherwise. */
  commissionValue: string;
}

export interface LedgerTradeInput {
  tradeNumber: number;
  direction: TradeDirection;
  entryTime: string;
  entryPrice: string;
  exitTime: string;
  exitPrice: string;
  quantity: string;
  reportedNetPnl: string | null;
}

export interface RecomputedTrade extends LedgerTradeInput {
  calcGrossPnl: string;
  calcCommission: string;
  calcNetPnl: string;
  holdingSeconds: number;
}

/**
 * Independent per-trade P&L from fill prices, quantity and the declared cost
 * model. Exported fill prices already include TradingView's slippage, so
 * slippage is not applied again. Point value is 1 (spot/linear contracts);
 * other contract specifications are out of scope for this release.
 */
export function recomputeTrade(trade: LedgerTradeInput, costs: CostModel): RecomputedTrade {
  const entry = new D(trade.entryPrice);
  const exit = new D(trade.exitPrice);
  const qty = new D(trade.quantity);
  const sign = trade.direction === "LONG" ? 1 : -1;
  const gross = exit.minus(entry).times(qty).times(sign);
  const value = new D(costs.commissionValue);
  let commission: Dec;
  switch (costs.commissionType) {
    case "percent":
      commission = entry.times(qty).plus(exit.times(qty)).times(value).div(100);
      break;
    case "cash_per_order":
      commission = value.times(2);
      break;
    case "cash_per_contract":
      commission = value.times(qty).times(2);
      break;
  }
  const holdingSeconds = Math.round((Date.parse(trade.exitTime) - Date.parse(trade.entryTime)) / 1000);
  return {
    ...trade,
    calcGrossPnl: toStorage(gross),
    calcCommission: toStorage(commission),
    calcNetPnl: toStorage(gross.minus(commission)),
    holdingSeconds,
  };
}

/** Canonical ledger order: exit time, then trade number. */
export function sortByExit<T extends { exitTime: string; tradeNumber: number }>(trades: readonly T[]): T[] {
  return [...trades].sort((a, b) => (a.exitTime === b.exitTime ? a.tradeNumber - b.tradeNumber : a.exitTime < b.exitTime ? -1 : 1));
}

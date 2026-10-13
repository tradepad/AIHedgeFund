import { z } from "zod";
import { DecimalStringSchema, UtcTimestampSchema } from "./common";
import { TradeDirectionSchema } from "./enums";

/** A closed trade normalised from a TradingView List of Trades export, plus ARF-recomputed P&L. */
export const TradeSchema = z.object({
  id: z.uuid(),
  backtestRunId: z.uuid(),
  tradeNumber: z.number().int().positive(),
  direction: TradeDirectionSchema,
  entryTime: UtcTimestampSchema,
  entryPrice: DecimalStringSchema,
  entrySignal: z.string().nullable(),
  exitTime: UtcTimestampSchema,
  exitPrice: DecimalStringSchema,
  exitSignal: z.string().nullable(),
  quantity: DecimalStringSchema,
  /** As reported by TradingView (net of commission). */
  reportedNetPnl: DecimalStringSchema.nullable(),
  /** ARF recomputation from prices, quantity and declared cost model. */
  calcGrossPnl: DecimalStringSchema,
  calcCommission: DecimalStringSchema,
  calcNetPnl: DecimalStringSchema,
  holdingSeconds: z.number().int().nonnegative(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const EquityPointSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: UtcTimestampSchema,
  equity: DecimalStringSchema,
  tradeNumber: z.number().int().nullable(),
});
export type EquityPoint = z.infer<typeof EquityPointSchema>;

export const DrawdownPointSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: UtcTimestampSchema,
  peakEquity: DecimalStringSchema,
  drawdown: DecimalStringSchema,
  /** Percentage points below the running peak (5 = 5%). */
  drawdownPct: DecimalStringSchema,
});
export type DrawdownPoint = z.infer<typeof DrawdownPointSchema>;

export const EquitySeriesSchema = z.object({
  backtestRunId: z.uuid(),
  calculationVersion: z.string(),
  basis: z.literal("CLOSED_TRADE_EQUITY"),
  label: z.literal("HISTORICAL_SIMULATED"),
  currency: z.string(),
  initialCapital: DecimalStringSchema,
  equity: z.array(EquityPointSchema),
  drawdown: z.array(DrawdownPointSchema),
});
export type EquitySeries = z.infer<typeof EquitySeriesSchema>;

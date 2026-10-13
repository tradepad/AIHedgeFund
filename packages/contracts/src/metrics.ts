import { z } from "zod";
import { DecimalStringSchema, UtcTimestampSchema } from "./common";
import { MetricScopeTypeSchema, MetricSourceSchema, MetricUnitSchema } from "./enums";

export const MetricNameSchema = z.enum([
  "closed_trade_count",
  "gross_profit",
  "gross_loss",
  "net_profit",
  "profit_factor",
  "win_rate_pct",
  "average_win",
  "average_loss",
  "payoff_ratio",
  "max_drawdown",
  "max_drawdown_pct",
  "longest_losing_streak",
  "average_holding_seconds",
  "monthly_return_pct",
  "total_return_pct",
  "commission_paid",
  "initial_capital",
]);
export type MetricName = z.infer<typeof MetricNameSchema>;

export const MetricValueStatusSchema = z.enum(["DEFINED", "UNDEFINED"]);

/**
 * One metric value. When a value is mathematically undefined (e.g. profit factor
 * with zero gross loss) it is stored as `UNDEFINED` with a reason, never as NaN
 * or silently dropped.
 */
export const MetricSnapshotSchema = z.object({
  id: z.uuid(),
  scopeType: MetricScopeTypeSchema,
  scopeId: z.uuid(),
  source: MetricSourceSchema,
  metricName: MetricNameSchema,
  /** `YYYY-MM` for monthly series, empty string for whole-scope values. */
  periodKey: z.string(),
  status: MetricValueStatusSchema,
  value: DecimalStringSchema.nullable(),
  undefinedReason: z.string().nullable(),
  unit: MetricUnitSchema,
  calculationVersion: z.string(),
  computedAt: UtcTimestampSchema,
});
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;

export const MetricsViewSchema = z.object({
  backtestRunId: z.uuid(),
  scopeType: MetricScopeTypeSchema,
  calculated: z.array(MetricSnapshotSchema),
  reported: z.array(MetricSnapshotSchema),
});
export type MetricsView = z.infer<typeof MetricsViewSchema>;

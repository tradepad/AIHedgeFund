import { and, asc, eq, gt } from "drizzle-orm";
import { MetricNameSchema, type EquitySeries, type MetricSnapshot, type MetricsView, type Trade } from "@arf/contracts";
import { backtestRuns, drawdownPoints, equityPoints, metricSnapshots, trades, type DbOrTx } from "@arf/db";
import { EQUITY_CALCULATION_VERSION, METRICS_CALCULATION_VERSION } from "@arf/metrics";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { TradeCursor, decodeCursor, page } from "../http/pagination";
import { iso, isoOrNull } from "./common";

type RunRow = typeof backtestRuns.$inferSelect;

export async function loadRun(db: DbOrTx, scope: RequestScope, id: string): Promise<RunRow> {
  const [row] = await db
    .select()
    .from(backtestRuns)
    .where(and(eq(backtestRuns.id, id), eq(backtestRuns.organisationId, scope.principal.organisationId)));
  if (!row) throw problems.notFound("backtest run");
  return row;
}

export async function getRun(ctx: AppContext, scope: RequestScope, id: string) {
  const r = await loadRun(ctx.db, scope, id);
  return {
    id: r.id,
    strategyVersionId: r.strategyVersionId,
    verificationId: r.verificationId,
    runnerType: r.runnerType,
    runnerVersion: r.runnerVersion,
    /** Every TradingView-sourced run is a historical simulation, never live performance. */
    evidenceLabel: "HISTORICAL_SIMULATED" as const,
    sourceHash: r.sourceHash,
    manifestHash: r.manifestHash,
    settingsHash: r.settingsHash,
    environmentHash: r.environmentHash,
    symbol: r.symbol,
    timeframe: r.timeframe,
    initialCapital: r.initialCapital,
    currency: r.currency,
    parsers: r.parsers,
    warnings: r.warnings,
    status: r.status,
    errorCode: r.errorCode,
    startedAt: iso(r.startedAt),
    completedAt: isoOrNull(r.completedAt),
  };
}

export async function listTrades(ctx: AppContext, scope: RequestScope, runId: string, q: { cursor?: string | undefined; limit: number }): Promise<{ items: Trade[]; nextCursor: string | null }> {
  await loadRun(ctx.db, scope, runId);
  const cursor = decodeCursor(TradeCursor, q.cursor);
  const rows = await ctx.db
    .select()
    .from(trades)
    .where(and(eq(trades.backtestRunId, runId), cursor ? gt(trades.tradeNumber, cursor.n) : undefined))
    .orderBy(asc(trades.tradeNumber))
    .limit(q.limit + 1);
  const p = page(rows, q.limit, (r) => ({ n: r.tradeNumber }));
  return {
    items: p.items.map((t) => ({
      id: t.id,
      backtestRunId: t.backtestRunId,
      tradeNumber: t.tradeNumber,
      direction: t.direction,
      entryTime: iso(t.entryTime),
      entryPrice: t.entryPrice,
      entrySignal: t.entrySignal,
      exitTime: iso(t.exitTime),
      exitPrice: t.exitPrice,
      exitSignal: t.exitSignal,
      quantity: t.quantity,
      reportedNetPnl: t.reportedNetPnl,
      calcGrossPnl: t.calcGrossPnl,
      calcCommission: t.calcCommission,
      calcNetPnl: t.calcNetPnl,
      holdingSeconds: t.holdingSeconds,
    })),
    nextCursor: p.nextCursor,
  };
}

export async function getEquity(ctx: AppContext, scope: RequestScope, runId: string): Promise<EquitySeries> {
  const run = await loadRun(ctx.db, scope, runId);
  const eq_ = await ctx.db
    .select()
    .from(equityPoints)
    .where(and(eq(equityPoints.backtestRunId, runId), eq(equityPoints.calculationVersion, EQUITY_CALCULATION_VERSION)))
    .orderBy(asc(equityPoints.seq));
  const dd = await ctx.db
    .select()
    .from(drawdownPoints)
    .where(and(eq(drawdownPoints.backtestRunId, runId), eq(drawdownPoints.calculationVersion, EQUITY_CALCULATION_VERSION)))
    .orderBy(asc(drawdownPoints.seq));
  if (eq_.length === 0) throw problems.notFound("equity series");
  return {
    backtestRunId: runId,
    calculationVersion: EQUITY_CALCULATION_VERSION,
    basis: "CLOSED_TRADE_EQUITY",
    label: "HISTORICAL_SIMULATED",
    currency: run.currency,
    initialCapital: run.initialCapital,
    equity: eq_.map((p) => ({ seq: p.seq, time: iso(p.time), equity: p.equity, tradeNumber: p.tradeNumber })),
    drawdown: dd.map((p) => ({ seq: p.seq, time: iso(p.time), peakEquity: p.peakEquity, drawdown: p.drawdown, drawdownPct: p.drawdownPct })),
  };
}

function toSnapshot(r: typeof metricSnapshots.$inferSelect): MetricSnapshot {
  return {
    id: r.id,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    source: r.source,
    metricName: MetricNameSchema.parse(r.metricName),
    periodKey: r.periodKey,
    status: r.status === "DEFINED" ? "DEFINED" : "UNDEFINED",
    value: r.value,
    undefinedReason: r.undefinedReason,
    unit: r.unit,
    calculationVersion: r.calculationVersion,
    computedAt: iso(r.computedAt),
  };
}

/** Calculated (ARF) and reported (TradingView) metrics are returned separately and never merged. */
export async function getMetrics(ctx: AppContext, scope: RequestScope, runId: string): Promise<MetricsView> {
  await loadRun(ctx.db, scope, runId);
  const rows = await ctx.db
    .select()
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.organisationId, scope.principal.organisationId), eq(metricSnapshots.scopeType, "RUN"), eq(metricSnapshots.scopeId, runId)))
    .orderBy(asc(metricSnapshots.metricName), asc(metricSnapshots.periodKey));
  const calculated = rows.filter((r) => r.source === "ARF_CALCULATED" && r.calculationVersion === METRICS_CALCULATION_VERSION);
  const reported = rows.filter((r) => r.source === "TRADINGVIEW_REPORTED");
  return { backtestRunId: runId, scopeType: "RUN", calculated: calculated.map(toSnapshot), reported: reported.map(toSnapshot) };
}

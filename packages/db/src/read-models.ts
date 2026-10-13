import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "./client";
import {
  backtestRuns,
  committeeDecisions,
  metricSnapshots,
  parityReports,
  strategies,
  strategyDefinitions,
  strategyLibraryReadModel,
  strategyVersions,
  tradingviewVerifications,
} from "./schema";

const LIBRARY_METRICS = [
  "closed_trade_count",
  "net_profit",
  "max_drawdown_pct",
  "profit_factor",
] as const;

function assetClassOf(content: unknown): string | null {
  if (typeof content !== "object" || content === null || !("market" in content)) return null;
  const market = content.market;
  if (typeof market !== "object" || market === null || !("assetClass" in market)) return null;
  return typeof market.assetClass === "string" ? market.assetClass : null;
}

/**
 * Rebuild one Strategy Library row from canonical tables. The read model is
 * derived and disposable: it is never a source of truth and can be rebuilt at
 * any time. Metrics shown are ARF-calculated values for the latest run only.
 */
export async function refreshStrategyLibraryRow(
  db: DbOrTx,
  strategyVersionId: string,
  metricsCalculationVersion: string,
): Promise<void> {
  const [row] = await db
    .select({ version: strategyVersions, strategy: strategies })
    .from(strategyVersions)
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .where(eq(strategyVersions.id, strategyVersionId));
  if (!row) return;
  const { version, strategy } = row;
  const [sdl] = await db
    .select({ content: strategyDefinitions.content })
    .from(strategyDefinitions)
    .where(eq(strategyDefinitions.strategyVersionId, version.id));
  const [verification] = await db
    .select({ id: tradingviewVerifications.id })
    .from(tradingviewVerifications)
    .where(eq(tradingviewVerifications.strategyVersionId, version.id))
    .orderBy(desc(tradingviewVerifications.id))
    .limit(1);
  let parityStatus: (typeof parityReports.$inferSelect)["status"] | null = null;
  const metrics = new Map<string, string | null>();
  if (verification) {
    const [parity] = await db
      .select({ status: parityReports.status })
      .from(parityReports)
      .where(eq(parityReports.verificationId, verification.id))
      .orderBy(desc(parityReports.createdAt))
      .limit(1);
    parityStatus = parity?.status ?? null;
    const [run] = await db
      .select({ id: backtestRuns.id })
      .from(backtestRuns)
      .where(eq(backtestRuns.verificationId, verification.id));
    if (run) {
      const values = await db
        .select({ name: metricSnapshots.metricName, value: metricSnapshots.value })
        .from(metricSnapshots)
        .where(
          and(
            eq(metricSnapshots.scopeType, "RUN"),
            eq(metricSnapshots.scopeId, run.id),
            eq(metricSnapshots.source, "ARF_CALCULATED"),
            eq(metricSnapshots.periodKey, ""),
            eq(metricSnapshots.calculationVersion, metricsCalculationVersion),
            inArray(metricSnapshots.metricName, [...LIBRARY_METRICS]),
          ),
        );
      for (const v of values) metrics.set(v.name, v.value);
    }
  }
  const [decision] = await db
    .select({ decision: committeeDecisions.decision })
    .from(committeeDecisions)
    .where(eq(committeeDecisions.strategyVersionId, version.id));
  const tradeCount = metrics.get("closed_trade_count");
  const values = {
    organisationId: version.organisationId,
    strategyId: strategy.id,
    campaignId: strategy.campaignId,
    strategyName: strategy.name,
    family: strategy.family,
    versionNumber: version.versionNumber,
    state: version.state,
    assetClass: assetClassOf(sdl?.content),
    symbol: version.symbol,
    timeframe: version.timeframe,
    parityStatus,
    closedTradeCount: tradeCount ? Math.trunc(Number(tradeCount)) : null,
    netProfit: metrics.get("net_profit") ?? null,
    maxDrawdownPct: metrics.get("max_drawdown_pct") ?? null,
    profitFactor: metrics.get("profit_factor") ?? null,
    lastDecision: decision?.decision ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(strategyLibraryReadModel)
    .values({ strategyVersionId: version.id, ...values })
    .onConflictDoUpdate({ target: strategyLibraryReadModel.strategyVersionId, set: values });
}

import { and, desc, eq } from "drizzle-orm";
import type { EvidenceSnapshot } from "@arf/contracts";
import { backtestRuns, metricSnapshots, parityReports, pineRevisions, reportUploads, strategyDefinitions, strategyVersions, tradingviewVerifications, type DbOrTx } from "@arf/db";
import { METRICS_CALCULATION_VERSION } from "@arf/metrics";

/** Below this many closed trades an approval needs an explicit, audited human override. */
export const MIN_CLOSED_TRADES_FOR_APPROVAL = 100;

/**
 * Server-side evidence snapshot for a version. Decisions and promotions are
 * evaluated against this, never against evidence ids chosen by the client, so
 * a failed verification cannot be hidden by offering an older one.
 */
export async function computeEvidence(db: DbOrTx, organisationId: string, versionId: string): Promise<EvidenceSnapshot & { evidenceIds: string[] }> {
  const [version] = await db
    .select()
    .from(strategyVersions)
    .where(and(eq(strategyVersions.id, versionId), eq(strategyVersions.organisationId, organisationId)));
  if (!version) throw new Error("version not found while computing evidence");
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const missingEvidence: string[] = [];
  const evidenceIds: string[] = [];

  const [sdl] = await db.select({ id: strategyDefinitions.id }).from(strategyDefinitions).where(eq(strategyDefinitions.strategyVersionId, versionId));
  if (sdl) evidenceIds.push(sdl.id);
  else missingEvidence.push("STRATEGY_DEFINITION");

  const [pine] = await db.select().from(pineRevisions).where(eq(pineRevisions.strategyVersionId, versionId));
  if (!pine) missingEvidence.push("PINE_REVISION");
  else {
    evidenceIds.push(pine.id);
    if (pine.lintStatus === "FAIL") hardFailures.push("PINE_LINT_FAIL");
    if (pine.lintStatus === "WARN") warnings.push("PINE_LINT_WARNINGS");
  }

  const [verification] = await db
    .select()
    .from(tradingviewVerifications)
    .where(eq(tradingviewVerifications.strategyVersionId, versionId))
    .orderBy(desc(tradingviewVerifications.id))
    .limit(1);
  let backtestRunId: string | null = null;
  let parityReportId: string | null = null;
  let parityStatus: EvidenceSnapshot["parityStatus"] = null;
  let closedTradeCount: number | null = null;

  if (!verification) missingEvidence.push("TRADINGVIEW_VERIFICATION");
  else {
    if (verification.status === "PARSE_FAILED") hardFailures.push("REPORT_PARSE_FAILED");
    if (verification.status !== "COMPLETED") missingEvidence.push("VERIFICATION_COMPLETED");
    const uploads = await db.select({ warnings: reportUploads.warnings, status: reportUploads.status }).from(reportUploads).where(eq(reportUploads.verificationId, verification.id));
    if (uploads.some((u) => u.status === "PARSED" && Array.isArray(u.warnings) && u.warnings.length > 0)) warnings.push("PARSER_WARNINGS");
    const [run] = await db.select({ id: backtestRuns.id }).from(backtestRuns).where(eq(backtestRuns.verificationId, verification.id));
    if (!run) missingEvidence.push("BACKTEST_RUN");
    else {
      backtestRunId = run.id;
      const [count] = await db
        .select({ value: metricSnapshots.value })
        .from(metricSnapshots)
        .where(
          and(
            eq(metricSnapshots.scopeType, "RUN"),
            eq(metricSnapshots.scopeId, run.id),
            eq(metricSnapshots.source, "ARF_CALCULATED"),
            eq(metricSnapshots.metricName, "closed_trade_count"),
            eq(metricSnapshots.calculationVersion, METRICS_CALCULATION_VERSION),
          ),
        );
      if (count?.value) {
        evidenceIds.push(run.id);
        closedTradeCount = Number(count.value);
        if (closedTradeCount < MIN_CLOSED_TRADES_FOR_APPROVAL) warnings.push("LOW_TRADE_COUNT");
      } else missingEvidence.push("METRICS");
    }
    const [parity] = await db.select().from(parityReports).where(eq(parityReports.verificationId, verification.id)).orderBy(desc(parityReports.createdAt)).limit(1);
    if (!parity) missingEvidence.push("PARITY_REPORT");
    else {
      parityReportId = parity.id;
      parityStatus = parity.status;
      evidenceIds.push(parity.id);
      if (parity.status === "FAIL") hardFailures.push("PARITY_FAIL");
      if (parity.status === "WARN") warnings.push("PARITY_WARN");
      if (parity.status === "INSUFFICIENT_DATA") missingEvidence.push("PARITY_CONCLUSIVE");
    }
  }

  return {
    strategyVersionId: versionId,
    state: version.state,
    definitionHash: version.definitionHash,
    pineSourceHash: version.pineSourceHash,
    manifestHash: version.manifestHash,
    verificationId: verification?.id ?? null,
    backtestRunId,
    parityReportId,
    parityStatus,
    closedTradeCount,
    hardFailures,
    warnings,
    missingEvidence,
    evidenceIds,
  };
}

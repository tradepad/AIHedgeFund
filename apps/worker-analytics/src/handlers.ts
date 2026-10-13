import { and, asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { EventPayloads, VerificationSettingsSchema, uuidv7, type DrawdownPoint } from "@arf/contracts";
import { deterministicUuid } from "@arf/contracts/node";
import {
  appendAudit,
  backtestRuns,
  drawdownPoints,
  enqueueOutbox,
  equityPoints,
  metricSnapshots,
  parityReports,
  pineRevisions,
  refreshStrategyLibraryRow,
  reportUploads,
  tradingviewVerifications,
  trades,
  type Database,
} from "@arf/db";
import { TerminalJobError, type JobPayload } from "@arf/event-bus";
import { EQUITY_CALCULATION_VERSION, METRICS_CALCULATION_VERSION, PARITY_POLICY_VERSION, computeCoreMetrics, computeParity, reconstructEquity } from "@arf/metrics";
import { instruments } from "@arf/observability";

export const SERVICE_ACTOR = { type: "SERVICE" as const, id: "service:worker-analytics" };

export interface AnalyticsDeps {
  db: Database;
}

const RunParsersSchema = z.array(z.object({ currency: z.string() }).loose());

const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

async function loadRun(db: Database, organisationId: string, runId: string) {
  const [run] = await db.select().from(backtestRuns).where(and(eq(backtestRuns.id, runId), eq(backtestRuns.organisationId, organisationId)));
  if (!run) throw new TerminalJobError("RUN_NOT_FOUND", "backtest run does not exist in this organisation");
  return run;
}

async function loadLedger(db: Database, runId: string) {
  const rows = await db.select().from(trades).where(eq(trades.backtestRunId, runId)).orderBy(asc(trades.tradeNumber));
  return rows.map((t) => ({
    tradeNumber: t.tradeNumber,
    entryTime: iso(t.entryTime),
    exitTime: iso(t.exitTime),
    entryPrice: t.entryPrice,
    quantity: t.quantity,
    reportedNetPnl: t.reportedNetPnl,
    calcNetPnl: t.calcNetPnl,
    calcCommission: t.calcCommission,
    holdingSeconds: t.holdingSeconds,
  }));
}

async function loadDrawdown(db: Database, runId: string): Promise<DrawdownPoint[]> {
  const rows = await db
    .select()
    .from(drawdownPoints)
    .where(and(eq(drawdownPoints.backtestRunId, runId), eq(drawdownPoints.calculationVersion, EQUITY_CALCULATION_VERSION)))
    .orderBy(asc(drawdownPoints.seq));
  return rows.map((p) => ({ seq: p.seq, time: iso(p.time), peakEquity: p.peakEquity, drawdown: p.drawdown, drawdownPct: p.drawdownPct }));
}

function emitNext(job: JobPayload, eventType: "equity.reconstructed" | "metrics.calculated", runId: string, verificationId: string) {
  return {
    eventId: deterministicUuid(`${eventType}|${runId}`),
    organisationId: job.organisationId,
    eventType,
    aggregateType: "BACKTEST_RUN" as const,
    aggregateId: runId,
    correlationId: job.correlationId,
    causationId: job.eventId,
    actor: SERVICE_ACTOR,
    traceId: job.traceId,
    payload: { verificationId, backtestRunId: runId },
  };
}

/** equity.reconstruct: closed-trade equity and drawdown curves, keyed by calculation version. */
export async function handleEquity(deps: AnalyticsDeps, job: JobPayload): Promise<{ backtestRunId: string }> {
  const data = EventPayloads["trades.normalised"].parse(job.payload);
  const run = await loadRun(deps.db, job.organisationId, data.backtestRunId);
  const ledger = await loadLedger(deps.db, run.id);
  const curve = reconstructEquity(run.initialCapital, ledger);
  await deps.db.transaction(async (tx) => {
    if (curve.equity.length > 0) {
      await tx
        .insert(equityPoints)
        .values(curve.equity.map((p) => ({ backtestRunId: run.id, seq: p.seq, organisationId: job.organisationId, time: new Date(p.time), equity: p.equity, tradeNumber: p.tradeNumber, calculationVersion: EQUITY_CALCULATION_VERSION })))
        .onConflictDoNothing();
      await tx
        .insert(drawdownPoints)
        .values(curve.drawdown.map((p) => ({ backtestRunId: run.id, seq: p.seq, organisationId: job.organisationId, time: new Date(p.time), peakEquity: p.peakEquity, drawdown: p.drawdown, drawdownPct: p.drawdownPct, calculationVersion: EQUITY_CALCULATION_VERSION })))
        .onConflictDoNothing();
    }
    await enqueueOutbox(tx, emitNext(job, "equity.reconstructed", run.id, data.verificationId));
  });
  return { backtestRunId: run.id };
}

/** metrics.calculate: independent ARF metrics from the recomputed ledger. */
export async function handleMetrics(deps: AnalyticsDeps, job: JobPayload): Promise<{ backtestRunId: string }> {
  const data = EventPayloads["equity.reconstructed"].parse(job.payload);
  const run = await loadRun(deps.db, job.organisationId, data.backtestRunId);
  const ledger = await loadLedger(deps.db, run.id);
  const drawdown = await loadDrawdown(deps.db, run.id);
  const values = computeCoreMetrics({ initialCapital: run.initialCapital, trades: ledger, drawdown });
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(metricSnapshots)
      .values(
        values.map((m) => ({
          id: uuidv7(),
          organisationId: job.organisationId,
          scopeType: "RUN" as const,
          scopeId: run.id,
          source: "ARF_CALCULATED" as const,
          metricName: m.name,
          periodKey: m.periodKey,
          status: m.status,
          value: m.value,
          undefinedReason: m.undefinedReason,
          unit: m.unit,
          calculationVersion: METRICS_CALCULATION_VERSION,
        })),
      )
      .onConflictDoNothing();
    await enqueueOutbox(tx, emitNext(job, "metrics.calculated", run.id, data.verificationId));
  });
  return { backtestRunId: run.id };
}

async function metricValue(db: Database, runId: string, source: "ARF_CALCULATED" | "TRADINGVIEW_REPORTED", name: string): Promise<string | null> {
  const rows = await db
    .select({ value: metricSnapshots.value, version: metricSnapshots.calculationVersion })
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.scopeType, "RUN"), eq(metricSnapshots.scopeId, runId), eq(metricSnapshots.source, source), eq(metricSnapshots.metricName, name), eq(metricSnapshots.periodKey, "")));
  const row = source === "ARF_CALCULATED" ? rows.find((r) => r.version === METRICS_CALCULATION_VERSION) : rows[0];
  return row?.value ?? null;
}

/** Verification window: dateFrom 00:00 to the day after dateTo 00:00, in the chart timezone, as UTC. */
export function verificationWindowUtc(settings: { chartTimezone: string; dateFrom: string; dateTo: string }): { start: string; end: string } {
  const start = DateTime.fromISO(settings.dateFrom, { zone: settings.chartTimezone }).startOf("day");
  const end = DateTime.fromISO(settings.dateTo, { zone: settings.chartTimezone }).plus({ days: 1 }).startOf("day");
  if (!start.isValid || !end.isValid) throw new TerminalJobError("INVALID_WINDOW", "verification date window is invalid");
  const fmt = (d: DateTime): string => d.toUTC().toISO({ suppressMilliseconds: true }) ?? "";
  return { start: fmt(start), end: fmt(end) };
}

/**
 * parity.calculate: compare TradingView-reported values with ARF's
 * independent recomputation. Completes the verification. The report is
 * immutable; a retry finds it and only re-emits.
 */
export async function handleParity(deps: AnalyticsDeps, job: JobPayload): Promise<{ backtestRunId: string }> {
  const data = EventPayloads["metrics.calculated"].parse(job.payload);
  const run = await loadRun(deps.db, job.organisationId, data.backtestRunId);
  const [verification] = await deps.db
    .select()
    .from(tradingviewVerifications)
    .where(and(eq(tradingviewVerifications.id, data.verificationId), eq(tradingviewVerifications.organisationId, job.organisationId)));
  if (!verification) throw new TerminalJobError("VERIFICATION_NOT_FOUND", "verification does not exist in this organisation");
  const settings = VerificationSettingsSchema.parse(verification.settings);
  const [pine] = await deps.db.select({ sourceHash: pineRevisions.sourceHash }).from(pineRevisions).where(eq(pineRevisions.id, verification.pineRevisionId));
  if (!pine) throw new TerminalJobError("PINE_REVISION_MISSING", "verification references a missing Pine revision");
  const uploads = await deps.db.select().from(reportUploads).where(and(eq(reportUploads.verificationId, verification.id), eq(reportUploads.status, "PARSED")));
  const window = verificationWindowUtc(settings);
  const parsers = RunParsersSchema.safeParse(run.parsers);
  if (!parsers.success) throw new TerminalJobError("RUN_PARSERS_INVALID", "backtest run parser metadata does not match its contract");
  const reportCurrencies = parsers.data.map((p) => p.currency);
  const ledger = await loadLedger(deps.db, run.id);
  const arfNetProfit = await metricValue(deps.db, run.id, "ARF_CALCULATED", "net_profit");
  const arfMaxDrawdown = await metricValue(deps.db, run.id, "ARF_CALCULATED", "max_drawdown");
  if (arfNetProfit === null || arfMaxDrawdown === null) throw new TerminalJobError("METRICS_MISSING", "ARF metrics are required before parity");

  const result = computeParity({
    expected: { pineSourceHash: pine.sourceHash, currency: settings.currency, initialCapital: settings.initialCapital, windowStartUtc: window.start, windowEndUtc: window.end },
    observed: {
      attestedPineSourceHashes: uploads.flatMap((u) => (u.attestedPineSourceHash ? [u.attestedPineSourceHash] : [])),
      reportCurrencies,
      reportedInitialCapital: await metricValue(deps.db, run.id, "TRADINGVIEW_REPORTED", "initial_capital"),
      reportedClosedTrades: await metricValue(deps.db, run.id, "TRADINGVIEW_REPORTED", "closed_trade_count"),
      reportedNetProfit: await metricValue(deps.db, run.id, "TRADINGVIEW_REPORTED", "net_profit"),
      reportedMaxDrawdown: await metricValue(deps.db, run.id, "TRADINGVIEW_REPORTED", "max_drawdown"),
      arfNetProfit,
      arfMaxDrawdown,
    },
    trades: ledger,
  });

  await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: parityReports.id })
      .from(parityReports)
      .where(and(eq(parityReports.verificationId, verification.id), eq(parityReports.policyVersion, PARITY_POLICY_VERSION)));
    const parityReportId = existing?.id ?? uuidv7();
    if (!existing) {
      await tx.insert(parityReports).values({
        id: parityReportId,
        organisationId: job.organisationId,
        verificationId: verification.id,
        backtestRunId: run.id,
        policyVersion: result.policyVersion,
        status: result.status,
        checks: result.checks,
        firstDivergence: result.firstDivergence,
      });
      if (result.status === "FAIL") instruments.parityFailures.add(1);
      await appendAudit(tx, {
        organisationId: job.organisationId,
        actorType: SERVICE_ACTOR.type,
        actorId: SERVICE_ACTOR.id,
        action: "PARITY_REPORT_CREATED",
        aggregateType: "VERIFICATION",
        aggregateId: verification.id,
        priorState: { status: verification.status },
        newState: { status: "COMPLETED", parityReportId, parityStatus: result.status, firstDivergence: result.firstDivergence?.check ?? null },
        reason: `parity ${result.status} under ${result.policyVersion}`,
        traceId: job.traceId,
      });
    }
    await tx
      .update(tradingviewVerifications)
      .set({ status: "COMPLETED", completedAt: verification.completedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(tradingviewVerifications.id, verification.id));
    await enqueueOutbox(tx, {
      eventId: deterministicUuid(`parity.calculated|${verification.id}|${PARITY_POLICY_VERSION}`),
      organisationId: job.organisationId,
      eventType: "parity.calculated",
      aggregateType: "VERIFICATION",
      aggregateId: verification.id,
      correlationId: job.correlationId,
      causationId: job.eventId,
      actor: SERVICE_ACTOR,
      traceId: job.traceId,
      payload: { verificationId: verification.id, backtestRunId: run.id, parityReportId, strategyVersionId: verification.strategyVersionId },
    });
  });
  return { backtestRunId: run.id };
}

/** read_model.refresh: rebuild the Strategy Library row the event touches. */
export async function handleReadModel(deps: AnalyticsDeps, job: JobPayload): Promise<void> {
  const p = job.payload;
  let versionId: string | null = typeof p.strategyVersionId === "string" ? p.strategyVersionId : null;
  if (!versionId && typeof p.verificationId === "string") {
    const [v] = await deps.db.select({ id: tradingviewVerifications.strategyVersionId }).from(tradingviewVerifications).where(eq(tradingviewVerifications.id, p.verificationId));
    versionId = v?.id ?? null;
  }
  versionId ??= job.aggregateId;
  await refreshStrategyLibraryRow(deps.db, versionId, METRICS_CALCULATION_VERSION);
}

import { and, eq, inArray, ne } from "drizzle-orm";
import {
  EventPayloads,
  VerificationSettingsSchema,
  canonicalJson,
  uuidv7,
  type DateOrder,
  type MetricName,
  type MetricUnit,
  type NumberLocale,
  type ParserWarning,
} from "@arf/contracts";
import { deterministicUuid, sha256Hex } from "@arf/contracts/node";
import {
  appendAudit,
  artefacts,
  backtestRuns,
  enqueueOutbox,
  pineRevisions,
  reportUploads,
  strategies,
  strategyVersions,
  tradingviewVerifications,
  trades,
  type Database,
  type DbOrTx,
  metricSnapshots,
} from "@arf/db";
import { TerminalJobError, type JobPayload } from "@arf/event-bus";
import { TRADE_RECOMPUTE_VERSION, recomputeTrade } from "@arf/metrics";
import {
  parseTradingViewReport,
  summaryValue,
  type ParsedReport,
  type ParsedTrade,
  type SummaryMetricKey,
} from "@arf/pine";
import { objectPaths, type ObjectStore } from "@arf/storage";
import { instruments } from "@arf/observability";

export const SERVICE_ACTOR = { type: "SERVICE" as const, id: "service:worker-backtest" };

export interface BacktestDeps {
  db: Database;
  store: ObjectStore;
}

type UploadRow = typeof reportUploads.$inferSelect;
type VerificationRow = typeof tradingviewVerifications.$inferSelect;

const asLocale = (v: string | null): NumberLocale | null =>
  v === "DOT_DECIMAL" || v === "COMMA_DECIMAL" ? v : null;
const asDateOrder = (v: string | null): DateOrder | null =>
  v === "YMD" || v === "DMY" || v === "MDY" ? v : null;

async function loadVerification(
  db: DbOrTx,
  organisationId: string,
  id: string,
): Promise<VerificationRow> {
  const [row] = await db
    .select()
    .from(tradingviewVerifications)
    .where(
      and(
        eq(tradingviewVerifications.id, id),
        eq(tradingviewVerifications.organisationId, organisationId),
      ),
    );
  if (!row)
    throw new TerminalJobError(
      "VERIFICATION_NOT_FOUND",
      "verification does not exist in this organisation",
    );
  return row;
}

async function versionBase(db: DbOrTx, verification: VerificationRow): Promise<string> {
  const [row] = await db
    .select({
      versionId: strategyVersions.id,
      strategyId: strategies.id,
      campaignId: strategies.campaignId,
    })
    .from(strategyVersions)
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .where(eq(strategyVersions.id, verification.strategyVersionId));
  if (!row)
    throw new TerminalJobError("VERSION_NOT_FOUND", "strategy version for verification is missing");
  return objectPaths.version({
    orgId: verification.organisationId,
    campaignId: row.campaignId,
    strategyId: row.strategyId,
    versionId: row.versionId,
  });
}

async function readRaw(deps: BacktestDeps, upload: UploadRow): Promise<Uint8Array> {
  if (!upload.rawArtefactId)
    throw new TerminalJobError("RAW_ARTEFACT_MISSING", "upload has no raw artefact");
  const [artefact] = await deps.db
    .select()
    .from(artefacts)
    .where(eq(artefacts.id, upload.rawArtefactId));
  if (!artefact) throw new TerminalJobError("RAW_ARTEFACT_MISSING", "raw artefact row missing");
  const bytes = await deps.store.get(artefact.objectKey);
  // Missing bytes may be eventual consistency in object storage: retryable.
  if (!bytes) throw new Error("raw report bytes not yet available in object storage");
  if (sha256Hex(bytes) !== artefact.sha256)
    throw new TerminalJobError(
      "RAW_ARTEFACT_CORRUPT",
      "raw report bytes do not match the recorded checksum",
    );
  return bytes;
}

function parseUpload(bytes: Uint8Array, upload: UploadRow, verification: VerificationRow) {
  const settings = VerificationSettingsSchema.parse(verification.settings);
  return parseTradingViewReport(bytes, {
    expectedType: upload.reportType,
    chartTimezone: settings.chartTimezone,
    numberLocaleHint: asLocale(verification.numberLocaleHint),
    dateOrderHint: asDateOrder(verification.dateOrderHint),
  });
}

/** Strip raw rows from the stored parsed document; the raw file is preserved separately. */
function parsedDocument(report: ParsedReport): Record<string, unknown> {
  const { rawRows: _rawRows, ...rest } = report;
  return { ...rest, rawRowCount: report.rawRows.length };
}

/**
 * report.parse: parse one uploaded export. Failures are recorded on the upload
 * and the verification (never hidden), then the job fails terminally so the
 * job record shows the error code too. Re-delivery after success is a no-op.
 */
export async function handleReportParse(deps: BacktestDeps, job: JobPayload): Promise<void> {
  const data = EventPayloads["report_upload.completed"].parse(job.payload);
  const [upload] = await deps.db
    .select()
    .from(reportUploads)
    .where(
      and(
        eq(reportUploads.id, data.uploadId),
        eq(reportUploads.organisationId, job.organisationId),
      ),
    );
  if (!upload)
    throw new TerminalJobError("UPLOAD_NOT_FOUND", "upload does not exist in this organisation");
  if (upload.status !== "UPLOADED") return; // already parsed, failed or superseded
  const verification = await loadVerification(deps.db, job.organisationId, upload.verificationId);
  const bytes = await readRaw(deps, upload);
  const parsed = parseUpload(bytes, upload, verification);

  if (!parsed.ok) {
    instruments.parseFailures.add(1, { code: parsed.error.code });
    await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: reportUploads.status })
        .from(reportUploads)
        .where(eq(reportUploads.id, upload.id))
        .for("update");
      if (locked?.status !== "UPLOADED") return;
      const warnings: ParserWarning[] = parsed.error.warnings;
      await tx
        .update(reportUploads)
        .set({
          status: "PARSE_FAILED",
          errorCode: parsed.error.code,
          errorDetail: parsed.error.detail,
          warnings,
          parsedAt: new Date(),
        })
        .where(eq(reportUploads.id, upload.id));
      await tx
        .update(tradingviewVerifications)
        .set({ status: "PARSE_FAILED", updatedAt: new Date() })
        .where(eq(tradingviewVerifications.id, verification.id));
      await appendAudit(tx, {
        organisationId: job.organisationId,
        actorType: SERVICE_ACTOR.type,
        actorId: SERVICE_ACTOR.id,
        action: "REPORT_PARSE_FAILED",
        aggregateType: "REPORT_UPLOAD",
        aggregateId: upload.id,
        priorState: { status: "UPLOADED" },
        newState: { status: "PARSE_FAILED", errorCode: parsed.error.code, row: parsed.error.row },
        reason: parsed.error.detail,
        traceId: job.traceId,
      });
    });
    throw new TerminalJobError(parsed.error.code, parsed.error.detail);
  }

  const report = parsed.report;
  const doc = new TextEncoder().encode(canonicalJson(parsedDocument(report)));
  const docSha = sha256Hex(doc);
  const base = await versionBase(deps.db, verification);
  const key = objectPaths.verificationParsed(base, verification.id, upload.id, docSha);
  await deps.store.putImmutable(key, doc, "application/json");

  await deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: reportUploads.status })
      .from(reportUploads)
      .where(eq(reportUploads.id, upload.id))
      .for("update");
    if (locked?.status !== "UPLOADED") return;
    const [existing] = await tx
      .select({ id: artefacts.id })
      .from(artefacts)
      .where(
        and(
          eq(artefacts.organisationId, job.organisationId),
          eq(artefacts.kind, "TRADINGVIEW_PARSED_REPORT"),
          eq(artefacts.sha256, docSha),
        ),
      );
    const artefactId = existing?.id ?? uuidv7();
    if (!existing) {
      await tx.insert(artefacts).values({
        id: artefactId,
        organisationId: job.organisationId,
        kind: "TRADINGVIEW_PARSED_REPORT",
        objectKey: key,
        sha256: docSha,
        sizeBytes: doc.byteLength,
        contentType: "application/json",
        createdBy: SERVICE_ACTOR.id,
      });
    }
    await tx
      .update(reportUploads)
      .set({
        status: "PARSED",
        parserId: report.parserId,
        parserVersion: report.parserVersion,
        warnings: report.warnings,
        parsedArtefactId: artefactId,
        parsedAt: new Date(),
      })
      .where(eq(reportUploads.id, upload.id));
    await appendAudit(tx, {
      organisationId: job.organisationId,
      actorType: SERVICE_ACTOR.type,
      actorId: SERVICE_ACTOR.id,
      action: "REPORT_PARSED",
      aggregateType: "REPORT_UPLOAD",
      aggregateId: upload.id,
      priorState: { status: "UPLOADED" },
      newState: {
        status: "PARSED",
        parserId: report.parserId,
        parserVersion: report.parserVersion,
        warningCount: report.warnings.length,
        parsedArtefactId: artefactId,
      },
      reason: `parsed ${report.reportType}`,
      traceId: job.traceId,
    });
    await enqueueOutbox(tx, {
      eventId: deterministicUuid(`report.parsed|${upload.id}`),
      organisationId: job.organisationId,
      eventType: "report.parsed",
      aggregateType: "REPORT_UPLOAD",
      aggregateId: upload.id,
      correlationId: job.correlationId,
      causationId: job.eventId,
      actor: SERVICE_ACTOR,
      traceId: job.traceId,
      payload: { verificationId: verification.id, uploadId: upload.id },
    });

    // When every required report is parsed, hand over to normalisation.
    const active = await tx
      .select({
        id: reportUploads.id,
        reportType: reportUploads.reportType,
        status: reportUploads.status,
      })
      .from(reportUploads)
      .where(
        and(
          eq(reportUploads.verificationId, verification.id),
          ne(reportUploads.status, "SUPERSEDED"),
        ),
      );
    const parsedTypes = active.filter((u) => u.status === "PARSED" || u.id === upload.id);
    const complete = verification.requiredReportTypes.every((t) =>
      parsedTypes.some((u) => u.reportType === t),
    );
    if (complete) {
      const ids = parsedTypes.map((u) => u.id).sort();
      await enqueueOutbox(tx, {
        eventId: deterministicUuid(
          `verification.reports_parsed|${verification.id}|${ids.join(",")}`,
        ),
        organisationId: job.organisationId,
        eventType: "verification.reports_parsed",
        aggregateType: "VERIFICATION",
        aggregateId: verification.id,
        correlationId: job.correlationId,
        causationId: job.eventId,
        actor: SERVICE_ACTOR,
        traceId: job.traceId,
        payload: { verificationId: verification.id },
      });
    }
  });
}

/** Load and re-parse the active parsed uploads; parsing is deterministic and versioned. */
export async function loadParsedReports(
  deps: BacktestDeps,
  verification: VerificationRow,
): Promise<{
  trades: { upload: UploadRow; report: ParsedReport };
  summary: { upload: UploadRow; report: ParsedReport };
}> {
  const uploads = await deps.db
    .select()
    .from(reportUploads)
    .where(
      and(
        eq(reportUploads.verificationId, verification.id),
        inArray(reportUploads.status, ["PARSED"]),
      ),
    );
  const find = (type: "LIST_OF_TRADES" | "PERFORMANCE_SUMMARY") =>
    uploads.find((u) => u.reportType === type);
  const tradesUpload = find("LIST_OF_TRADES");
  const summaryUpload = find("PERFORMANCE_SUMMARY");
  if (!tradesUpload || !summaryUpload)
    throw new TerminalJobError("REPORTS_INCOMPLETE", "both reports must be parsed");
  const reparse = async (upload: UploadRow) => {
    const result = parseUpload(await readRaw(deps, upload), upload, verification);
    if (!result.ok) throw new TerminalJobError(result.error.code, result.error.detail);
    if (
      result.report.parserId !== upload.parserId ||
      result.report.parserVersion !== upload.parserVersion
    ) {
      throw new TerminalJobError(
        "PARSER_VERSION_CHANGED",
        "parser version differs from the one recorded at parse time",
      );
    }
    return { upload, report: result.report };
  };
  return { trades: await reparse(tradesUpload), summary: await reparse(summaryUpload) };
}

/**
 * TradingView-reported summary values mapped to ARF metric names. Reported
 * values are stored as TRADINGVIEW_REPORTED and never merged with ARF values.
 */
const REPORTED_METRICS: readonly {
  key: SummaryMetricKey;
  column: "value" | "valuePct";
  name: MetricName;
  unit: MetricUnit;
}[] = [
  { key: "net_profit", column: "value", name: "net_profit", unit: "CURRENCY" },
  { key: "net_profit", column: "valuePct", name: "total_return_pct", unit: "PERCENT_POINTS" },
  { key: "gross_profit", column: "value", name: "gross_profit", unit: "CURRENCY" },
  { key: "gross_loss", column: "value", name: "gross_loss", unit: "CURRENCY" },
  { key: "max_drawdown", column: "value", name: "max_drawdown", unit: "CURRENCY" },
  { key: "max_drawdown", column: "valuePct", name: "max_drawdown_pct", unit: "PERCENT_POINTS" },
  { key: "profit_factor", column: "value", name: "profit_factor", unit: "RATIO" },
  { key: "commission_paid", column: "value", name: "commission_paid", unit: "CURRENCY" },
  { key: "total_closed_trades", column: "value", name: "closed_trade_count", unit: "COUNT" },
  { key: "percent_profitable", column: "valuePct", name: "win_rate_pct", unit: "PERCENT_POINTS" },
  { key: "initial_capital", column: "value", name: "initial_capital", unit: "CURRENCY" },
];

export function reportedMetricValues(
  summary: ParsedReport,
): { name: MetricName; unit: MetricUnit; value: string }[] {
  const out: { name: MetricName; unit: MetricUnit; value: string }[] = [];
  for (const m of REPORTED_METRICS) {
    const v = summaryValue(summary, m.key);
    const value = v ? v[m.column] : null;
    if (value !== null) out.push({ name: m.name, unit: m.unit, value });
  }
  return out;
}

/**
 * trades.normalise: create the backtest run for a verification and its
 * normalised trade ledger with ARF-recomputed P&L. One run per verification
 * (unique constraint); a retry finds the existing run and only re-emits.
 */
export async function handleTradesNormalise(
  deps: BacktestDeps,
  job: JobPayload,
): Promise<{ backtestRunId: string }> {
  const data = EventPayloads["verification.reports_parsed"].parse(job.payload);
  const verification = await loadVerification(deps.db, job.organisationId, data.verificationId);
  const settings = VerificationSettingsSchema.parse(verification.settings);
  const [pine] = await deps.db
    .select()
    .from(pineRevisions)
    .where(eq(pineRevisions.id, verification.pineRevisionId));
  if (!pine)
    throw new TerminalJobError(
      "PINE_REVISION_MISSING",
      "verification references a missing Pine revision",
    );
  const reports = await loadParsedReports(deps, verification);
  if (reports.trades.report.data.kind !== "LIST_OF_TRADES")
    throw new TerminalJobError("REPORT_KIND", "unexpected trades report kind");
  const parsedTrades: ParsedTrade[] = reports.trades.report.data.trades;
  const costs = {
    commissionType: settings.commissionType,
    commissionValue: settings.commissionValue,
  };
  const ledger = parsedTrades.map((t) => ({ parsed: t, calc: recomputeTrade(t, costs) }));
  const parsers = [reports.trades.report, reports.summary.report].map((r) => ({
    reportType: r.reportType,
    parserId: r.parserId,
    parserVersion: r.parserVersion,
    numberLocale: r.numberLocale,
    dateOrder: r.dateOrder,
    delimiter: r.delimiter,
    currency: r.currency,
  }));
  const warnings = [...reports.trades.report.warnings, ...reports.summary.report.warnings].map(
    (w) => ({ ...w, source: "TRADINGVIEW_PARSER" }),
  );
  const environmentHash = sha256Hex(
    canonicalJson({ runner: "TRADINGVIEW", parsers, tradeRecompute: TRADE_RECOMPUTE_VERSION }),
  );

  return deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: backtestRuns.id })
      .from(backtestRuns)
      .where(eq(backtestRuns.verificationId, verification.id));
    const runId = existing?.id ?? uuidv7();
    if (!existing) {
      await tx.insert(backtestRuns).values({
        id: runId,
        organisationId: job.organisationId,
        strategyVersionId: verification.strategyVersionId,
        verificationId: verification.id,
        runnerType: "TRADINGVIEW",
        runnerVersion: `tradingview-export/${parsers.map((p) => `${p.parserId}@${p.parserVersion}`).join("+")}`,
        sourceHash: pine.sourceHash,
        manifestHash: pine.manifestHash,
        settingsHash: verification.settingsHash,
        environmentHash,
        symbol: settings.symbol,
        timeframe: settings.timeframe,
        initialCapital: settings.initialCapital,
        currency: settings.currency,
        parsers,
        warnings,
        status: "SUCCEEDED",
        completedAt: new Date(),
      });
      if (ledger.length > 0) {
        await tx
          .insert(trades)
          .values(
            ledger.map(({ parsed, calc }) => ({
              id: uuidv7(),
              organisationId: job.organisationId,
              backtestRunId: runId,
              tradeNumber: parsed.tradeNumber,
              direction: parsed.direction,
              entryTime: new Date(parsed.entryTime),
              entryPrice: parsed.entryPrice,
              entrySignal: parsed.entrySignal,
              exitTime: new Date(parsed.exitTime),
              exitPrice: parsed.exitPrice,
              exitSignal: parsed.exitSignal,
              quantity: parsed.quantity,
              reportedNetPnl: parsed.reportedNetPnl,
              calcGrossPnl: calc.calcGrossPnl,
              calcCommission: calc.calcCommission,
              calcNetPnl: calc.calcNetPnl,
              holdingSeconds: calc.holdingSeconds,
              rawRows: {
                rowNumbers: parsed.rawRowNumbers,
                reportedNetPnlPct: parsed.reportedNetPnlPct,
                reportedCumulativePnl: parsed.reportedCumulativePnl,
              },
            })),
          )
          .onConflictDoNothing();
      }
      const reported = reportedMetricValues(reports.summary.report);
      if (reported.length > 0) {
        await tx
          .insert(metricSnapshots)
          .values(
            reported.map((m) => ({
              id: uuidv7(),
              organisationId: job.organisationId,
              scopeType: "RUN" as const,
              scopeId: runId,
              source: "TRADINGVIEW_REPORTED" as const,
              metricName: m.name,
              periodKey: "",
              status: "DEFINED",
              value: m.value,
              undefinedReason: null,
              unit: m.unit,
              calculationVersion: `${reports.summary.report.parserId}@${reports.summary.report.parserVersion}`,
            })),
          )
          .onConflictDoNothing();
      }
      await appendAudit(tx, {
        organisationId: job.organisationId,
        actorType: SERVICE_ACTOR.type,
        actorId: SERVICE_ACTOR.id,
        action: "BACKTEST_RUN_RECORDED",
        aggregateType: "BACKTEST_RUN",
        aggregateId: runId,
        priorState: null,
        newState: {
          verificationId: verification.id,
          tradeCount: ledger.length,
          sourceHash: pine.sourceHash,
          environmentHash,
          runnerType: "TRADINGVIEW",
        },
        reason: "TradingView trade ledger normalised",
        traceId: job.traceId,
      });
    }
    await enqueueOutbox(tx, {
      eventId: deterministicUuid(`trades.normalised|${runId}`),
      organisationId: job.organisationId,
      eventType: "trades.normalised",
      aggregateType: "BACKTEST_RUN",
      aggregateId: runId,
      correlationId: job.correlationId,
      causationId: job.eventId,
      actor: SERVICE_ACTOR,
      traceId: job.traceId,
      payload: { verificationId: verification.id, backtestRunId: runId },
    });
    return { backtestRunId: runId };
  });
}

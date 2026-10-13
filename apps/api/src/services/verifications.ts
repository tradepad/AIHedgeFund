import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import {
  ParityCheckSchema,
  ParserWarningSchema,
  PineManifestSchema,
  VerificationSettingsSchema,
  canonicalJson,
  uuidv7,
  type CompleteReportUploadRequest,
  type CreateReportUploadRequest,
  type CreateVerificationRequest,
  type ParityReport,
  type PresignedUpload,
  type ReportType,
  type ReportUpload,
  type Verification,
  type VerificationSettings,
  type VerificationStatusView,
} from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { backtestRuns, jobRuns, parityReports, pineRevisions, reportUploads, tradingviewVerifications, type DbOrTx, type Tx } from "@arf/db";
import { D } from "@arf/metrics";
import { objectPaths } from "@arf/storage";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { audit, emit, iso, isoOrNull, storeArtefact } from "./common";
import { loadVersion } from "./registry";

type VerificationRow = typeof tradingviewVerifications.$inferSelect;
type UploadRow = typeof reportUploads.$inferSelect;

export const REQUIRED_REPORT_TYPES: readonly ReportType[] = ["PERFORMANCE_SUMMARY", "LIST_OF_TRADES"];
const PRESIGN_TTL_SECONDS = 15 * 60;

const COMMISSION_TYPES = {
  "strategy.commission.percent": "percent",
  "strategy.commission.cash_per_order": "cash_per_order",
  "strategy.commission.cash_per_contract": "cash_per_contract",
} as const;

const dec = (n: number): string => new D(n).toFixed();

export function toVerification(row: VerificationRow, backtestRunId: string | null, pine: { sourceHash: string; manifestHash: string }): Verification {
  return {
    id: row.id,
    strategyVersionId: row.strategyVersionId,
    pineRevisionId: row.pineRevisionId,
    pineSourceHash: pine.sourceHash,
    manifestHash: pine.manifestHash,
    status: row.status,
    settings: VerificationSettingsSchema.parse(row.settings),
    settingsHash: row.settingsHash,
    requiredReportTypes: row.requiredReportTypes,
    numberLocaleHint: row.numberLocaleHint === "DOT_DECIMAL" || row.numberLocaleHint === "COMMA_DECIMAL" ? row.numberLocaleHint : null,
    dateOrderHint: row.dateOrderHint === "YMD" || row.dateOrderHint === "DMY" || row.dateOrderHint === "MDY" ? row.dateOrderHint : null,
    backtestRunId,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    completedAt: isoOrNull(row.completedAt),
  };
}

export function toUpload(row: UploadRow): ReportUpload {
  return {
    id: row.id,
    verificationId: row.verificationId,
    reportType: row.reportType,
    status: row.status,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    declaredSha256: row.declaredSha256,
    rawArtefactId: row.rawArtefactId,
    parsedArtefactId: row.parsedArtefactId,
    parserId: row.parserId,
    parserVersion: row.parserVersion,
    warnings: ParserWarningSchema.array().parse(row.warnings),
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    uploadedBy: row.uploadedBy,
    createdAt: iso(row.createdAt),
    completedAt: isoOrNull(row.completedAt),
  };
}

export async function loadVerification(db: DbOrTx, scope: RequestScope, id: string, lock = false): Promise<VerificationRow> {
  const q = db
    .select()
    .from(tradingviewVerifications)
    .where(and(eq(tradingviewVerifications.id, id), eq(tradingviewVerifications.organisationId, scope.principal.organisationId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw problems.notFound("verification");
  return row;
}

async function hydrate(db: DbOrTx, row: VerificationRow): Promise<Verification> {
  const [pine] = await db.select({ sourceHash: pineRevisions.sourceHash, manifestHash: pineRevisions.manifestHash }).from(pineRevisions).where(eq(pineRevisions.id, row.pineRevisionId));
  if (!pine) throw new Error("verification references a missing Pine revision");
  const [run] = await db.select({ id: backtestRuns.id }).from(backtestRuns).where(eq(backtestRuns.verificationId, row.id));
  return toVerification(row, run?.id ?? null, pine);
}

/**
 * Create a human-assisted TradingView verification task (spec §10.4). The
 * settings snapshot is derived from the immutable Pine manifest so the
 * operator reproduces exactly what was declared; only the chart timezone and
 * date window are chosen at creation.
 */
export async function createVerification(tx: Tx, scope: RequestScope, body: CreateVerificationRequest): Promise<Verification> {
  const { version } = await loadVersion(tx, scope, body.strategyVersionId, true);
  if (version.state !== "TRADINGVIEW_VERIFICATION") {
    throw problems.conflict("INVALID_STATE", "verifications can only be created while the version is in TRADINGVIEW_VERIFICATION");
  }
  const [pine] = await tx.select().from(pineRevisions).where(eq(pineRevisions.strategyVersionId, version.id));
  if (!pine) throw problems.unprocessable("PINE_REVISION_REQUIRED", "the version has no Pine revision");
  if (pine.lintStatus === "FAIL") throw problems.unprocessable("PINE_LINT_FAILED", "a Pine revision with lint hard errors cannot be verified");
  const open = await tx
    .select({ id: tradingviewVerifications.id })
    .from(tradingviewVerifications)
    .where(and(eq(tradingviewVerifications.strategyVersionId, version.id), ne(tradingviewVerifications.status, "PARSE_FAILED")));
  if (open.length > 0) {
    throw problems.conflict("VERIFICATION_EXISTS", "this version already has a verification; a new one is allowed only after a parse failure");
  }
  const manifest = PineManifestSchema.parse(pine.manifest);
  const p = manifest.properties;
  const settings: VerificationSettings = VerificationSettingsSchema.parse({
    symbol: version.symbol,
    timeframe: version.timeframe,
    chartTimezone: body.chartTimezone,
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
    initialCapital: dec(p.initialCapital),
    currency: p.currency,
    commissionType: COMMISSION_TYPES[p.commissionType],
    commissionValue: dec(p.commissionValue),
    slippageTicks: p.slippageTicks,
    defaultQtyType: p.defaultQtyType,
    defaultQtyValue: dec(p.defaultQtyValue),
    marginLongPct: dec(p.marginLongPct),
    marginShortPct: dec(p.marginShortPct),
    pyramiding: p.pyramiding,
    processOrdersOnClose: p.processOrdersOnClose,
    calcOnEveryTick: p.calcOnEveryTick,
    barMagnifier: body.barMagnifier,
  });
  const id = uuidv7();
  const [row] = await tx
    .insert(tradingviewVerifications)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      strategyVersionId: version.id,
      pineRevisionId: pine.id,
      status: "AWAITING_UPLOADS",
      settings,
      settingsHash: sha256Hex(canonicalJson(settings)),
      requiredReportTypes: [...REQUIRED_REPORT_TYPES],
      numberLocaleHint: body.numberLocaleHint ?? null,
      dateOrderHint: body.dateOrderHint ?? null,
      createdBy: scope.principal.userId,
    })
    .returning();
  if (!row) throw new Error("verification insert returned no row");
  await audit(tx, scope, {
    action: "VERIFICATION_CREATED",
    aggregateType: "VERIFICATION",
    aggregateId: id,
    newState: { strategyVersionId: version.id, pineSourceHash: pine.sourceHash, settingsHash: row.settingsHash },
    reason: "TradingView verification requested",
  });
  await emit(tx, scope, { eventType: "verification.created", aggregateType: "VERIFICATION", aggregateId: id, payload: { verificationId: id, strategyVersionId: version.id } });
  return toVerification(row, null, { sourceHash: pine.sourceHash, manifestHash: pine.manifestHash });
}

export async function listVerifications(ctx: AppContext, scope: RequestScope, versionId: string): Promise<Verification[]> {
  await loadVersion(ctx.db, scope, versionId);
  const rows = await ctx.db
    .select()
    .from(tradingviewVerifications)
    .where(and(eq(tradingviewVerifications.organisationId, scope.principal.organisationId), eq(tradingviewVerifications.strategyVersionId, versionId)))
    .orderBy(desc(tradingviewVerifications.id));
  return Promise.all(rows.map((r) => hydrate(ctx.db, r)));
}

export async function getVerificationStatus(ctx: AppContext, scope: RequestScope, id: string): Promise<VerificationStatusView> {
  const row = await loadVerification(ctx.db, scope, id);
  const uploads = await ctx.db.select().from(reportUploads).where(eq(reportUploads.verificationId, id)).orderBy(asc(reportUploads.id));
  const jobs = await ctx.db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.organisationId, scope.principal.organisationId), eq(jobRuns.verificationId, id)))
    .orderBy(asc(jobRuns.createdAt));
  return {
    verification: await hydrate(ctx.db, row),
    uploads: uploads.map(toUpload),
    jobs: jobs.map((j) => ({ jobKey: j.jobKey, jobName: j.jobName, status: j.status, attempts: j.attempts, lastErrorCode: j.lastErrorCode, updatedAt: iso(j.updatedAt) })),
  };
}

async function stagingBase(tx: DbOrTx, scope: RequestScope, verification: VerificationRow): Promise<string> {
  const { version, strategy } = await loadVersion(tx, scope, verification.strategyVersionId);
  return objectPaths.version({ orgId: scope.principal.organisationId, campaignId: strategy.campaignId, strategyId: strategy.id, versionId: version.id });
}

/**
 * Reserve an upload slot and return a presigned PUT. A previous upload of the
 * same report type is superseded (kept, never deleted) unless it is already
 * queued for parsing.
 */
export async function createUpload(ctx: AppContext, tx: Tx, scope: RequestScope, verificationId: string, body: CreateReportUploadRequest): Promise<PresignedUpload> {
  const verification = await loadVerification(tx, scope, verificationId, true);
  if (verification.status === "COMPLETED") throw problems.conflict("VERIFICATION_COMPLETED", "this verification is complete; evidence can no longer be replaced");
  if (!verification.requiredReportTypes.includes(body.reportType)) throw problems.unprocessable("REPORT_TYPE_NOT_REQUIRED", `${body.reportType} is not part of this verification`);
  const [active] = await tx
    .select()
    .from(reportUploads)
    .where(and(eq(reportUploads.verificationId, verificationId), eq(reportUploads.reportType, body.reportType), ne(reportUploads.status, "SUPERSEDED")));
  if (active) {
    if (active.status === "UPLOADED") throw problems.conflict("UPLOAD_PROCESSING", "the current upload of this report type is being parsed");
    await tx.update(reportUploads).set({ status: "SUPERSEDED" }).where(eq(reportUploads.id, active.id));
  }
  const uploadId = uuidv7();
  const key = objectPaths.verificationStaging(await stagingBase(tx, scope, verification), verificationId, uploadId);
  await tx.insert(reportUploads).values({
    id: uploadId,
    organisationId: scope.principal.organisationId,
    verificationId,
    reportType: body.reportType,
    status: "PENDING_UPLOAD",
    fileName: body.fileName,
    contentType: "text/csv",
    sizeBytes: body.sizeBytes,
    declaredSha256: body.sha256,
    stagingObjectKey: key,
    uploadedBy: scope.principal.userId,
  });
  if (verification.status === "PARSE_FAILED") {
    await tx.update(tradingviewVerifications).set({ status: "AWAITING_UPLOADS", updatedAt: new Date() }).where(eq(tradingviewVerifications.id, verificationId));
  }
  await audit(tx, scope, {
    action: "REPORT_UPLOAD_REQUESTED",
    aggregateType: "REPORT_UPLOAD",
    aggregateId: uploadId,
    newState: { verificationId, reportType: body.reportType, sha256: body.sha256, sizeBytes: body.sizeBytes, supersedes: active?.id ?? null },
    reason: "presigned upload issued",
  });
  const presigned = await ctx.store.presignPut({ key, contentType: "text/csv", sizeBytes: body.sizeBytes, sha256Hex: body.sha256, expiresInSeconds: PRESIGN_TTL_SECONDS });
  return { uploadId, method: "PUT", url: presigned.url, headers: presigned.headers, expiresAt: iso(presigned.expiresAt) };
}

/**
 * Confirm an upload. The object must exist with the declared checksum, and the
 * operator must attest the Pine source hash they ran, which must equal the
 * verified revision. The raw bytes are copied into an immutable,
 * content-addressed artefact before parsing is queued.
 */
export async function completeUpload(ctx: AppContext, tx: Tx, scope: RequestScope, verificationId: string, body: CompleteReportUploadRequest): Promise<ReportUpload> {
  const verification = await loadVerification(tx, scope, verificationId, true);
  const [upload] = await tx
    .select()
    .from(reportUploads)
    .where(and(eq(reportUploads.id, body.uploadId), eq(reportUploads.verificationId, verificationId), eq(reportUploads.organisationId, scope.principal.organisationId)))
    .for("update");
  if (!upload) throw problems.notFound("report upload");
  if (upload.status !== "PENDING_UPLOAD") throw problems.conflict("UPLOAD_NOT_PENDING", `upload is ${upload.status}`);
  const [pine] = await tx.select({ sourceHash: pineRevisions.sourceHash }).from(pineRevisions).where(eq(pineRevisions.id, verification.pineRevisionId));
  if (!pine) throw new Error("verification references a missing Pine revision");
  if (body.attestedPineSourceHash !== pine.sourceHash) {
    throw problems.unprocessable("ATTESTED_SOURCE_MISMATCH", "the attested Pine source hash does not match the revision under verification");
  }
  const bytes = await ctx.store.get(upload.stagingObjectKey);
  if (!bytes) throw problems.unprocessable("UPLOAD_NOT_RECEIVED", "no file has been uploaded for this upload id");
  if (bytes.byteLength !== upload.sizeBytes || sha256Hex(bytes) !== upload.declaredSha256) {
    throw problems.unprocessable("UPLOAD_CHECKSUM_MISMATCH", "uploaded file does not match the declared size and sha256");
  }
  const raw = await storeArtefact(tx, ctx.store, {
    organisationId: scope.principal.organisationId,
    kind: "TRADINGVIEW_RAW_REPORT",
    key: objectPaths.verificationRaw(await stagingBase(tx, scope, verification), verificationId, upload.declaredSha256),
    bytes,
    contentType: "text/csv",
    createdBy: scope.principal.userId,
  });
  const [updated] = await tx
    .update(reportUploads)
    .set({ status: "UPLOADED", rawArtefactId: raw.id, attestedPineSourceHash: body.attestedPineSourceHash, completedAt: new Date() })
    .where(eq(reportUploads.id, upload.id))
    .returning();
  if (!updated) throw new Error("upload update returned no row");

  const active = await tx
    .select({ reportType: reportUploads.reportType })
    .from(reportUploads)
    .where(and(eq(reportUploads.verificationId, verificationId), inArray(reportUploads.status, ["UPLOADED", "PARSED"])));
  const ready = verification.requiredReportTypes.every((t) => active.some((a) => a.reportType === t));
  if (ready && verification.status !== "PROCESSING") {
    await tx.update(tradingviewVerifications).set({ status: "PROCESSING", updatedAt: new Date() }).where(eq(tradingviewVerifications.id, verificationId));
  }
  await audit(tx, scope, {
    action: "REPORT_UPLOAD_COMPLETED",
    aggregateType: "REPORT_UPLOAD",
    aggregateId: upload.id,
    priorState: { status: "PENDING_UPLOAD" },
    newState: { status: "UPLOADED", rawArtefactId: raw.id, sha256: upload.declaredSha256, attestedPineSourceHash: body.attestedPineSourceHash, attestedSettingsMatch: true },
    reason: "operator confirmed upload and attested settings",
  });
  await emit(tx, scope, { eventType: "report_upload.completed", aggregateType: "REPORT_UPLOAD", aggregateId: upload.id, payload: { verificationId, uploadId: upload.id } });
  return toUpload(updated);
}

export function toParity(row: typeof parityReports.$inferSelect): ParityReport {
  return {
    id: row.id,
    verificationId: row.verificationId,
    backtestRunId: row.backtestRunId,
    policyVersion: row.policyVersion,
    status: row.status,
    checks: ParityCheckSchema.array().parse(row.checks),
    firstDivergence: ParityCheckSchema.nullable().parse(row.firstDivergence ?? null),
    createdAt: iso(row.createdAt),
  };
}

export async function getParity(ctx: AppContext, scope: RequestScope, verificationId: string): Promise<ParityReport> {
  await loadVerification(ctx.db, scope, verificationId);
  const [row] = await ctx.db.select().from(parityReports).where(eq(parityReports.verificationId, verificationId)).orderBy(desc(parityReports.createdAt)).limit(1);
  if (!row) throw problems.notFound("parity report");
  return toParity(row);
}

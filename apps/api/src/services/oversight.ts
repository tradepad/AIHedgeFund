import { and, count, desc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import {
  AuditEventSchema,
  ParityStatusSchema,
  WorkflowStateSchema,
  type AuditEvent,
  type StrategyLibraryRow,
} from "@arf/contracts";
import {
  artefacts,
  auditEvents,
  backtestRuns,
  campaigns,
  committeeDecisions,
  jobRuns,
  reportUploads,
  strategyLibraryReadModel,
  strategyVersions,
  tradingviewVerifications,
  verifyAuditChain,
  type DbOrTx,
} from "@arf/db";
import { hasPermission } from "@arf/auth";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { SeqCursor, UpdatedCursor, decodeCursor, page } from "../http/pagination";
import { audit, iso } from "./common";
import { loadVersion } from "./registry";

function toAuditEvent(r: typeof auditEvents.$inferSelect): AuditEvent {
  return AuditEventSchema.parse({
    id: r.id,
    seq: r.seq,
    actorType: r.actorType,
    actorId: r.actorId,
    action: r.action,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    priorState: r.priorState ?? null,
    newState: r.newState ?? null,
    reason: r.reason,
    traceId: r.traceId,
    hash: r.hash,
    prevHash: r.prevHash,
    createdAt: iso(r.createdAt),
  });
}

/** Every aggregate whose audit trail belongs on a version's timeline. */
async function versionAggregateIds(
  db: DbOrTx,
  organisationId: string,
  versionId: string,
): Promise<string[]> {
  const verifications = await db
    .select({ id: tradingviewVerifications.id })
    .from(tradingviewVerifications)
    .where(
      and(
        eq(tradingviewVerifications.organisationId, organisationId),
        eq(tradingviewVerifications.strategyVersionId, versionId),
      ),
    );
  const vIds = verifications.map((v) => v.id);
  const uploads =
    vIds.length > 0
      ? await db
          .select({ id: reportUploads.id })
          .from(reportUploads)
          .where(inArray(reportUploads.verificationId, vIds))
      : [];
  const runs = await db
    .select({ id: backtestRuns.id })
    .from(backtestRuns)
    .where(eq(backtestRuns.strategyVersionId, versionId));
  const decisions = await db
    .select({ id: committeeDecisions.id })
    .from(committeeDecisions)
    .where(eq(committeeDecisions.strategyVersionId, versionId));
  return [
    versionId,
    ...vIds,
    ...uploads.map((u) => u.id),
    ...runs.map((r) => r.id),
    ...decisions.map((d) => d.id),
  ];
}

export async function versionAuditTimeline(
  ctx: AppContext,
  scope: RequestScope,
  versionId: string,
  q: { cursor?: string | undefined; limit: number },
) {
  await loadVersion(ctx.db, scope, versionId);
  const ids = await versionAggregateIds(ctx.db, scope.principal.organisationId, versionId);
  return auditPage(ctx.db, scope, [inArray(auditEvents.aggregateId, ids)], q);
}

export async function aggregateAuditTimeline(
  ctx: AppContext,
  scope: RequestScope,
  aggregateIds: string[],
  q: { cursor?: string | undefined; limit: number },
) {
  return auditPage(ctx.db, scope, [inArray(auditEvents.aggregateId, aggregateIds)], q);
}

export async function organisationAudit(
  ctx: AppContext,
  scope: RequestScope,
  q: { cursor?: string | undefined; limit: number },
) {
  return auditPage(ctx.db, scope, [], q);
}

async function auditPage(
  db: DbOrTx,
  scope: RequestScope,
  filters: SQL[],
  q: { cursor?: string | undefined; limit: number },
) {
  const cursor = decodeCursor(SeqCursor, q.cursor);
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, scope.principal.organisationId),
        ...filters,
        cursor ? lt(auditEvents.seq, cursor.seq) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(q.limit + 1);
  const p = page(rows, q.limit, (r) => ({ seq: r.seq }));
  return { items: p.items.map(toAuditEvent), nextCursor: p.nextCursor };
}

export async function verifyChain(ctx: AppContext, scope: RequestScope) {
  return verifyAuditChain(ctx.db, scope.principal.organisationId);
}

export async function commandCentre(ctx: AppContext, scope: RequestScope) {
  const org = scope.principal.organisationId;
  const byState = await ctx.db
    .select({ state: strategyVersions.state, n: count() })
    .from(strategyVersions)
    .where(eq(strategyVersions.organisationId, org))
    .groupBy(strategyVersions.state);
  const [activeCampaigns] = await ctx.db
    .select({ n: count() })
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, org), eq(campaigns.status, "ACTIVE")));
  const awaitingDecision = await ctx.db
    .select()
    .from(strategyLibraryReadModel)
    .where(
      and(
        eq(strategyLibraryReadModel.organisationId, org),
        eq(strategyLibraryReadModel.state, "PAPER_APPROVAL_REVIEW"),
      ),
    )
    .orderBy(desc(strategyLibraryReadModel.updatedAt))
    .limit(20);
  const verifications = await ctx.db
    .select()
    .from(tradingviewVerifications)
    .where(
      and(
        eq(tradingviewVerifications.organisationId, org),
        inArray(tradingviewVerifications.status, [
          "AWAITING_UPLOADS",
          "PROCESSING",
          "PARSE_FAILED",
        ]),
      ),
    )
    .orderBy(desc(tradingviewVerifications.updatedAt))
    .limit(20);
  const failedJobs = await ctx.db
    .select()
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.organisationId, org),
        inArray(jobRuns.status, ["FAILED_TERMINAL", "FAILED_RETRYABLE"]),
        gte(jobRuns.updatedAt, new Date(Date.now() - 7 * 86_400_000)),
      ),
    )
    .orderBy(desc(jobRuns.updatedAt))
    .limit(20);
  const recent = await ctx.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, org))
    .orderBy(desc(auditEvents.seq))
    .limit(15);
  return {
    generatedAt: iso(new Date()),
    activeCampaigns: activeCampaigns?.n ?? 0,
    versionCountsByState: Object.fromEntries(byState.map((r) => [r.state, r.n])),
    awaitingDecision: awaitingDecision.map(toLibraryRow),
    openVerifications: verifications.map((v) => ({
      id: v.id,
      strategyVersionId: v.strategyVersionId,
      status: v.status,
      updatedAt: iso(v.updatedAt),
    })),
    failedJobs: failedJobs.map((j) => ({
      jobKey: j.jobKey,
      jobName: j.jobName,
      status: j.status,
      attempts: j.attempts,
      lastErrorCode: j.lastErrorCode,
      verificationId: j.verificationId,
      updatedAt: iso(j.updatedAt),
    })),
    recentActivity: recent.map(toAuditEvent),
  };
}

function toLibraryRow(r: typeof strategyLibraryReadModel.$inferSelect): StrategyLibraryRow {
  return {
    strategyVersionId: r.strategyVersionId,
    strategyId: r.strategyId,
    campaignId: r.campaignId,
    strategyName: r.strategyName,
    family: r.family,
    versionNumber: r.versionNumber,
    state: r.state,
    assetClass: r.assetClass,
    symbol: r.symbol,
    timeframe: r.timeframe,
    parityStatus: r.parityStatus,
    closedTradeCount: r.closedTradeCount,
    netProfit: r.netProfit,
    maxDrawdownPct: r.maxDrawdownPct,
    profitFactor: r.profitFactor,
    lastDecision: r.lastDecision,
    updatedAt: iso(r.updatedAt),
  };
}

export async function strategyLibrary(
  ctx: AppContext,
  scope: RequestScope,
  q: {
    state?: string | undefined;
    assetClass?: string | undefined;
    timeframe?: string | undefined;
    parityStatus?: string | undefined;
    updatedAfter?: string | undefined;
    cursor?: string | undefined;
    limit: number;
    campaignId?: string | undefined;
  },
): Promise<{ items: StrategyLibraryRow[]; nextCursor: string | null }> {
  const filters: (SQL | undefined)[] = [
    eq(strategyLibraryReadModel.organisationId, scope.principal.organisationId),
  ];
  if (q.state) {
    const state = WorkflowStateSchema.safeParse(q.state);
    if (!state.success) throw problems.badRequest("INVALID_FILTER", "unknown state filter");
    filters.push(eq(strategyLibraryReadModel.state, state.data));
  }
  if (q.parityStatus) {
    const parity = ParityStatusSchema.safeParse(q.parityStatus);
    if (!parity.success) throw problems.badRequest("INVALID_FILTER", "unknown parity filter");
    filters.push(eq(strategyLibraryReadModel.parityStatus, parity.data));
  }
  if (q.assetClass) filters.push(eq(strategyLibraryReadModel.assetClass, q.assetClass));
  if (q.timeframe) filters.push(eq(strategyLibraryReadModel.timeframe, q.timeframe));
  if (q.campaignId) filters.push(eq(strategyLibraryReadModel.campaignId, q.campaignId));
  if (q.updatedAfter)
    filters.push(gte(strategyLibraryReadModel.updatedAt, new Date(q.updatedAfter)));
  const cursor = decodeCursor(UpdatedCursor, q.cursor);
  if (cursor) {
    const t = new Date(cursor.t);
    filters.push(
      or(
        lt(strategyLibraryReadModel.updatedAt, t),
        and(
          eq(strategyLibraryReadModel.updatedAt, t),
          lt(strategyLibraryReadModel.strategyVersionId, cursor.id),
        ),
      ),
    );
  }
  const rows = await ctx.db
    .select()
    .from(strategyLibraryReadModel)
    .where(and(...filters))
    .orderBy(
      desc(strategyLibraryReadModel.updatedAt),
      desc(strategyLibraryReadModel.strategyVersionId),
    )
    .limit(q.limit + 1);
  const p = page(rows, q.limit, (r) => ({ t: r.updatedAt.toISOString(), id: r.strategyVersionId }));
  return { items: p.items.map(toLibraryRow), nextCursor: p.nextCursor };
}

/**
 * Download an artefact. Organisation ownership is always enforced; PROTECTED
 * artefacts additionally require `protected:read` and every read is audited.
 */
export async function readArtefact(
  ctx: AppContext,
  scope: RequestScope,
  id: string,
): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
  const [row] = await ctx.db
    .select()
    .from(artefacts)
    .where(and(eq(artefacts.id, id), eq(artefacts.organisationId, scope.principal.organisationId)));
  if (!row) throw problems.notFound("artefact");
  if (row.protection === "PROTECTED") {
    if (!hasPermission(scope.principal.roles, "protected:read"))
      throw problems.forbidden("PROTECTED_ARTEFACT", "this artefact requires protected:read");
    await audit(ctx.db, scope, {
      action: "PROTECTED_ARTEFACT_READ",
      aggregateType: "ARTEFACT",
      aggregateId: row.id,
      newState: { kind: row.kind, sha256: row.sha256 },
      reason: "protected artefact downloaded",
    });
  }
  const bytes = await ctx.store.get(row.objectKey);
  if (!bytes) throw new Error("artefact bytes are missing from object storage");
  const ext = row.contentType.startsWith("application/json")
    ? "json"
    : row.contentType.startsWith("text/csv")
      ? "csv"
      : row.kind === "PINE_SOURCE"
        ? "pine"
        : "txt";
  return {
    bytes,
    contentType: row.contentType,
    fileName: `${row.kind.toLowerCase()}-${row.sha256.slice(0, 12)}.${ext}`,
  };
}

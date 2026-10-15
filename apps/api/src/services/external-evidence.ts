import { and, asc, count, eq } from "drizzle-orm";
import {
  ExternalExtraMetricsSchema,
  ExternalSettingsSchema,
  canonicalJson,
  uuidv7,
  type ExternalCampaignInput,
  type ExternalEvidenceView,
  type ExternalImportBundle,
  type ExternalImportSummary,
  type ExternalResult,
  type ExternalResultInput,
  type ExternalStrategyInput,
  type ExternalVersionInput,
} from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import {
  artefacts,
  campaigns,
  externalBacktestResults,
  externalImportBatches,
  externalStrategyImports,
  strategies,
  strategyVersions,
  type Tx,
} from "@arf/db";
import { objectPaths } from "@arf/storage";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { createCampaign } from "./campaigns";
import { audit, iso, storeArtefact, utf8 } from "./common";
import { createStrategy, createVersion, loadVersion } from "./registry";

type Counter = { created: number; reused: number };
const counter = (): Counter => ({ created: 0, reused: 0 });

/**
 * Import research done outside ARF-OS as external evidence.
 *
 * Creates (or reuses, on a re-run) campaigns, strategies and immutable root or
 * child versions through the registry services, so every row carries the same
 * audit and outbox records as a version created in the UI. Results are stored
 * in the external evidence tables only: they never become ARF metrics, never
 * satisfy workflow evidence and never change a version's lifecycle state.
 *
 * Idempotent: campaigns are matched by name, strategies by name, versions and
 * results by their import keys. Reusing a key with different content is
 * rejected rather than silently overwritten.
 */
export async function importExternalBundle(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  bundle: ExternalImportBundle,
): Promise<ExternalImportSummary> {
  const org = scope.principal.organisationId;
  const bundleBytes = utf8(canonicalJson(bundle));
  const bundleSha = sha256Hex(bundleBytes);
  const bundleArtefact = await storeArtefact(tx, ctx.store, {
    organisationId: org,
    kind: "EXTERNAL_IMPORT_BUNDLE",
    key: objectPaths.externalImportBundle(org, bundleSha),
    bytes: bundleBytes,
    contentType: "application/json",
    createdBy: scope.principal.userId,
  });
  await tx
    .insert(externalImportBatches)
    .values({
      id: uuidv7(),
      organisationId: org,
      batchKey: bundle.batchId,
      title: bundle.title,
      description: bundle.description,
      schemaVersion: bundle.schemaVersion,
      bundleArtefactId: bundleArtefact.id,
      bundleSha256: bundleSha,
      importedBy: scope.principal.userId,
    })
    .onConflictDoNothing();
  const [batch] = await tx
    .select({ id: externalImportBatches.id })
    .from(externalImportBatches)
    .where(
      and(
        eq(externalImportBatches.organisationId, org),
        eq(externalImportBatches.bundleSha256, bundleSha),
      ),
    );
  if (!batch) throw new Error("external import batch missing after insert");

  const summary = {
    campaigns: counter(),
    strategies: counter(),
    versions: counter(),
    results: counter(),
    versionIds: [] as string[],
  };
  for (const campaign of bundle.campaigns) {
    const campaignId = await ensureCampaign(tx, scope, campaign, summary.campaigns);
    for (const strategy of campaign.strategies) {
      await importStrategy(ctx, tx, scope, batch.id, campaignId, strategy, summary);
    }
  }
  return { batchId: bundle.batchId, bundleSha256: bundleSha, ...summary };
}

async function ensureCampaign(
  tx: Tx,
  scope: RequestScope,
  input: ExternalCampaignInput,
  c: Counter,
): Promise<string> {
  const [existing] = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organisationId, scope.principal.organisationId),
        eq(campaigns.name, input.name),
      ),
    )
    .orderBy(asc(campaigns.id))
    .limit(1);
  if (existing) {
    c.reused++;
    return existing.id;
  }
  const created = await createCampaign(tx, scope, {
    name: input.name,
    objective: input.objective,
    assetClasses: input.assetClasses,
    timeframes: input.timeframes,
  });
  c.created++;
  return created.id;
}

async function importStrategy(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  batchId: string,
  campaignId: string,
  input: ExternalStrategyInput,
  summary: {
    strategies: Counter;
    versions: Counter;
    results: Counter;
    versionIds: string[];
  },
): Promise<void> {
  const org = scope.principal.organisationId;
  const [existing] = await tx
    .select()
    .from(strategies)
    .where(and(eq(strategies.organisationId, org), eq(strategies.name, input.name)));
  let strategyId: string;
  if (existing) {
    if (existing.campaignId !== campaignId)
      throw problems.conflict(
        "STRATEGY_NAME_TAKEN",
        `strategy "${input.name}" already exists in a different campaign`,
      );
    strategyId = existing.id;
    summary.strategies.reused++;
  } else {
    strategyId = (
      await createStrategy(tx, scope, { campaignId, name: input.name, family: input.family })
    ).id;
    summary.strategies.created++;
  }

  let previous: { versionId: string; results: ExternalResultInput[] } | null = null;
  for (const [index, version] of input.versions.entries()) {
    const versionId = await ensureVersion(ctx, tx, scope, {
      batchId,
      strategyId,
      strategyName: input.name,
      index,
      version,
      previous,
      counter: summary.versions,
    });
    summary.versionIds.push(versionId);
    const [imported] = await tx
      .select({ id: externalStrategyImports.id })
      .from(externalStrategyImports)
      .where(eq(externalStrategyImports.strategyVersionId, versionId));
    if (!imported) throw new Error("external strategy import row missing");
    let created = 0;
    for (const result of version.results) {
      if (await ensureResult(tx, scope, imported.id, versionId, result)) created++;
    }
    summary.results.created += created;
    summary.results.reused += version.results.length - created;
    if (created > 0) {
      await audit(tx, scope, {
        action: "EXTERNAL_EVIDENCE_IMPORTED",
        aggregateType: "STRATEGY_VERSION",
        aggregateId: versionId,
        newState: {
          importKey: version.key,
          resultKeys: version.results.map((r) => r.key),
          resultsCreated: created,
        },
        reason: "external evidence imported; not ARF-verified",
      });
    }
    previous = { versionId, results: version.results };
  }
}

async function ensureVersion(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  p: {
    batchId: string;
    strategyId: string;
    strategyName: string;
    index: number;
    version: ExternalVersionInput;
    previous: { versionId: string; results: ExternalResultInput[] } | null;
    counter: Counter;
  },
): Promise<string> {
  const org = scope.principal.organisationId;
  const v = p.version;
  const [known] = await tx
    .select({ import: externalStrategyImports, version: strategyVersions })
    .from(externalStrategyImports)
    .innerJoin(strategyVersions, eq(strategyVersions.id, externalStrategyImports.strategyVersionId))
    .where(
      and(
        eq(externalStrategyImports.organisationId, org),
        eq(externalStrategyImports.importKey, v.key),
      ),
    );
  if (known) {
    const sourceSha = v.source ? sha256Hex(utf8(v.source.code)) : null;
    if (
      known.version.strategyId !== p.strategyId ||
      known.version.symbol !== v.symbol ||
      known.version.timeframe !== v.timeframe ||
      known.import.sourceSha256 !== sourceSha
    ) {
      throw problems.conflict(
        "IMPORT_KEY_REUSED",
        `import key ${v.key} was already imported with a different strategy, symbol, timeframe or source; use a new key`,
      );
    }
    p.counter.reused++;
    return known.version.id;
  }

  if (p.index === 0) {
    const [agg] = await tx
      .select({ n: count() })
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, p.strategyId));
    if ((agg?.n ?? 0) > 0)
      throw problems.conflict(
        "STRATEGY_HAS_VERSIONS",
        `strategy "${p.strategyName}" already has versions that this import did not create`,
      );
  }
  const changeReason = `Imported external research: ${v.description}`.slice(0, 1000);
  const created =
    p.index === 0 || !p.previous || !v.change
      ? await createVersion(tx, scope, p.strategyId, {
          kind: "ROOT",
          symbol: v.symbol,
          timeframe: v.timeframe,
          changeReason,
        })
      : await createVersion(tx, scope, p.strategyId, {
          kind: "CHILD",
          parentVersionId: p.previous.versionId,
          symbol: v.symbol,
          timeframe: v.timeframe,
          changeReason,
          changeCategories: v.change.categories,
          changedFields: v.change.fields,
          motivatingEvidenceIds: p.previous.results.map((r) => `external:${r.key}`),
          // The tweak was chosen after looking at the parent's results, so the
          // data those results covered is no longer unseen for this child.
          contaminatedData: p.previous.results
            .filter((r) => r.runStatus === "COMPLETED")
            .map(
              (r) =>
                `external:${r.engine}:${v.symbol}:${v.timeframe}:${r.windowFrom ?? "?"}..${r.windowTo ?? "?"}`,
            ),
        });

  let source: { language: "PINE" | "PYTHON"; sha: string; artefactId: string } | null = null;
  if (v.source) {
    const { version, strategy } = await loadVersion(tx, scope, created.id);
    const base = objectPaths.version({
      orgId: org,
      campaignId: strategy.campaignId,
      strategyId: strategy.id,
      versionId: version.id,
    });
    const bytes = utf8(v.source.code);
    const sha = sha256Hex(bytes);
    const artefact = await storeArtefact(tx, ctx.store, {
      organisationId: org,
      kind: "EXTERNAL_STRATEGY_SOURCE",
      key: objectPaths.externalSource(base, sha, v.source.language === "PINE" ? "pine" : "py"),
      bytes,
      contentType: "text/plain; charset=utf-8",
      createdBy: scope.principal.userId,
    });
    source = { language: v.source.language, sha, artefactId: artefact.id };
  }
  await tx.insert(externalStrategyImports).values({
    id: uuidv7(),
    organisationId: org,
    batchId: p.batchId,
    importKey: v.key,
    strategyVersionId: created.id,
    externalStrategyId: v.externalStrategyId,
    sourceLanguage: source?.language ?? null,
    sourceSha256: source?.sha ?? null,
    sourceArtefactId: source?.artefactId ?? null,
    importedBy: scope.principal.userId,
  });
  p.counter.created++;
  return created.id;
}

/** Returns true when a new row was written, false when an identical row already existed. */
async function ensureResult(
  tx: Tx,
  scope: RequestScope,
  importId: string,
  versionId: string,
  r: ExternalResultInput,
): Promise<boolean> {
  const org = scope.principal.organisationId;
  const contentHash = sha256Hex(utf8(canonicalJson(r)));
  const [existing] = await tx
    .select({
      contentHash: externalBacktestResults.contentHash,
      versionId: externalBacktestResults.strategyVersionId,
    })
    .from(externalBacktestResults)
    .where(
      and(
        eq(externalBacktestResults.organisationId, org),
        eq(externalBacktestResults.resultKey, r.key),
      ),
    );
  if (existing) {
    if (existing.contentHash !== contentHash || existing.versionId !== versionId)
      throw problems.conflict(
        "IMPORT_KEY_REUSED",
        `result key ${r.key} was already imported with different content; use a new key`,
      );
    return false;
  }
  await tx.insert(externalBacktestResults).values({
    id: uuidv7(),
    organisationId: org,
    strategyImportId: importId,
    strategyVersionId: versionId,
    resultKey: r.key,
    contentHash,
    engine: r.engine,
    engineVersion: r.engineVersion,
    provenance: r.provenance,
    segment: r.segment,
    runStatus: r.runStatus,
    windowFrom: r.windowFrom,
    windowTo: r.windowTo,
    externalResultId: r.externalResultId,
    closedTradeCount: r.metrics.closedTradeCount,
    profitFactor: r.metrics.profitFactor,
    maxDrawdownPct: r.metrics.maxDrawdownPct,
    netProfitPct: r.metrics.netProfitPct,
    netProfit: r.metrics.netProfit,
    largestWin: r.metrics.largestWin,
    currency: r.metrics.currency,
    extraMetrics: r.extraMetrics,
    settings: r.settings,
    verdict: r.verdict,
    verdictReasons: r.verdictReasons,
    notes: r.notes,
  });
  return true;
}

/** Numeric columns come back with scale padding; trim to the plain decimal the import supplied. */
function decimal(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function toResult(row: typeof externalBacktestResults.$inferSelect): ExternalResult {
  return {
    id: row.id,
    key: row.resultKey,
    engine: row.engine,
    engineVersion: row.engineVersion,
    provenance: row.provenance,
    segment: row.segment,
    runStatus: row.runStatus,
    windowFrom: row.windowFrom,
    windowTo: row.windowTo,
    externalResultId: row.externalResultId,
    metrics: {
      closedTradeCount: row.closedTradeCount,
      profitFactor: decimal(row.profitFactor),
      maxDrawdownPct: decimal(row.maxDrawdownPct),
      netProfitPct: decimal(row.netProfitPct),
      netProfit: decimal(row.netProfit),
      largestWin: decimal(row.largestWin),
      currency: row.currency,
    },
    extraMetrics: ExternalExtraMetricsSchema.parse(row.extraMetrics),
    settings: ExternalSettingsSchema.parse(row.settings),
    verdict: row.verdict,
    verdictReasons: row.verdictReasons,
    notes: row.notes,
    importedAt: iso(row.createdAt),
  };
}

/** External evidence for one version, with the imported source when there is one. */
export async function getExternalEvidence(
  ctx: AppContext,
  scope: RequestScope,
  versionId: string,
): Promise<ExternalEvidenceView> {
  await loadVersion(ctx.db, scope, versionId);
  const org = scope.principal.organisationId;
  const [row] = await ctx.db
    .select({ import: externalStrategyImports, batch: externalImportBatches })
    .from(externalStrategyImports)
    .innerJoin(externalImportBatches, eq(externalImportBatches.id, externalStrategyImports.batchId))
    .where(
      and(
        eq(externalStrategyImports.organisationId, org),
        eq(externalStrategyImports.strategyVersionId, versionId),
      ),
    );
  if (!row) return { import: null, results: [] };
  const results = await ctx.db
    .select()
    .from(externalBacktestResults)
    .where(
      and(
        eq(externalBacktestResults.organisationId, org),
        eq(externalBacktestResults.strategyVersionId, versionId),
      ),
    )
    .orderBy(asc(externalBacktestResults.id));

  let source: NonNullable<ExternalEvidenceView["import"]>["source"] = null;
  const imp = row.import;
  if (imp.sourceArtefactId && imp.sourceSha256 && imp.sourceLanguage) {
    const [artefact] = await ctx.db
      .select()
      .from(artefacts)
      .where(and(eq(artefacts.id, imp.sourceArtefactId), eq(artefacts.organisationId, org)));
    const bytes = artefact ? await ctx.store.get(artefact.objectKey) : null;
    if (!bytes) throw new Error("external source artefact is missing from object storage");
    if (sha256Hex(bytes) !== imp.sourceSha256)
      throw new Error("external source artefact does not match its recorded hash");
    source = {
      language: imp.sourceLanguage,
      sha256: imp.sourceSha256,
      code: new TextDecoder().decode(bytes),
    };
  }
  return {
    import: {
      id: imp.id,
      batchId: row.batch.batchKey,
      batchTitle: row.batch.title,
      key: imp.importKey,
      externalStrategyId: imp.externalStrategyId,
      source,
      importedBy: imp.importedBy,
      importedAt: iso(imp.createdAt),
    },
    results: results.map(toResult),
  };
}

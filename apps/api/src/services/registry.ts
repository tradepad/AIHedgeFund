import { and, asc, eq, max } from "drizzle-orm";
import {
  PineLintResultSchema,
  PineManifestSchema,
  StrategyDefinitionSchema,
  canonicalJson,
  uuidv7,
  type CreateStrategyRequest,
  type CreateStrategyVersionRequest,
  type LineageNode,
  type PineLintResult,
  type PineManifest,
  type PineRevisionRecord,
  type PutPineRevisionRequest,
  type Strategy,
  type StrategyDefinition,
  type StrategyDefinitionRecord,
  type StrategyVersion,
} from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import {
  artefacts,
  ideaCards,
  pineRevisions,
  strategies,
  strategyDefinitions,
  strategyLineage,
  strategyVersions,
  type DbOrTx,
  type Tx,
} from "@arf/db";
import {
  lintPine,
  manifestFromDefinition,
  normalisePineSource,
  pineManifestHash,
  pineSourceHash,
  renderTrendPullbackTemplate,
} from "@arf/pine";
import { objectPaths } from "@arf/storage";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { audit, emit, iso, isoOrNull, storeArtefact, utf8 } from "./common";
import { loadCampaign } from "./campaigns";

type VersionRow = typeof strategyVersions.$inferSelect;
type StrategyRow = typeof strategies.$inferSelect;

export function toStrategy(row: StrategyRow): Strategy {
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    family: row.family,
    ideaCardId: row.ideaCardId,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

export function toVersion(row: VersionRow, strategy: StrategyRow): StrategyVersion {
  return {
    id: row.id,
    strategyId: row.strategyId,
    strategyName: strategy.name,
    campaignId: strategy.campaignId,
    parentVersionId: row.parentVersionId,
    versionNumber: row.versionNumber,
    state: row.state,
    symbol: row.symbol,
    timeframe: row.timeframe,
    definitionHash: row.definitionHash,
    pineSourceHash: row.pineSourceHash,
    manifestHash: row.manifestHash,
    changeReason: row.changeReason,
    createdBy: row.createdBy,
    lockedAt: isoOrNull(row.lockedAt),
    createdAt: iso(row.createdAt),
  };
}

export async function loadStrategy(
  db: DbOrTx,
  scope: RequestScope,
  id: string,
  lock = false,
): Promise<StrategyRow> {
  const q = db
    .select()
    .from(strategies)
    .where(
      and(eq(strategies.id, id), eq(strategies.organisationId, scope.principal.organisationId)),
    );
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw problems.notFound("strategy");
  return row;
}

export async function loadVersion(
  db: DbOrTx,
  scope: RequestScope,
  id: string,
  lock = false,
): Promise<{ version: VersionRow; strategy: StrategyRow }> {
  const q = db
    .select({ version: strategyVersions, strategy: strategies })
    .from(strategyVersions)
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .where(
      and(
        eq(strategyVersions.id, id),
        eq(strategyVersions.organisationId, scope.principal.organisationId),
      ),
    );
  const [row] = lock ? await q.for("update", { of: strategyVersions }) : await q;
  if (!row) throw problems.notFound("strategy version");
  return row;
}

export async function createStrategy(
  tx: Tx,
  scope: RequestScope,
  body: CreateStrategyRequest,
): Promise<Strategy> {
  const campaign = await loadCampaign(tx, scope, body.campaignId);
  if (campaign.status !== "ACTIVE")
    throw problems.conflict(
      "CAMPAIGN_NOT_ACTIVE",
      "strategies can only be added to active campaigns",
    );
  if (body.ideaCardId) {
    const [idea] = await tx
      .select({ id: ideaCards.id })
      .from(ideaCards)
      .where(
        and(
          eq(ideaCards.id, body.ideaCardId),
          eq(ideaCards.organisationId, scope.principal.organisationId),
          eq(ideaCards.campaignId, body.campaignId),
        ),
      );
    if (!idea)
      throw problems.unprocessable(
        "IDEA_NOT_IN_CAMPAIGN",
        "the idea card does not belong to this campaign",
      );
  }
  const [existing] = await tx
    .select({ id: strategies.id })
    .from(strategies)
    .where(
      and(
        eq(strategies.organisationId, scope.principal.organisationId),
        eq(strategies.name, body.name),
      ),
    );
  if (existing)
    throw problems.conflict("STRATEGY_NAME_TAKEN", "a strategy with this name already exists");
  const id = uuidv7();
  const [row] = await tx
    .insert(strategies)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      campaignId: body.campaignId,
      name: body.name,
      family: body.family,
      ideaCardId: body.ideaCardId ?? null,
      createdBy: scope.principal.userId,
    })
    .returning();
  if (!row) throw new Error("strategy insert returned no row");
  await audit(tx, scope, {
    action: "STRATEGY_CREATED",
    aggregateType: "STRATEGY",
    aggregateId: id,
    newState: { name: body.name, campaignId: body.campaignId },
    reason: "strategy created",
  });
  return toStrategy(row);
}

export async function getStrategy(
  ctx: AppContext,
  scope: RequestScope,
  id: string,
): Promise<{ strategy: Strategy; versions: StrategyVersion[] }> {
  const strategy = await loadStrategy(ctx.db, scope, id);
  const versions = await ctx.db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, id))
    .orderBy(asc(strategyVersions.versionNumber));
  return { strategy: toStrategy(strategy), versions: versions.map((v) => toVersion(v, strategy)) };
}

/**
 * Create an immutable version. Root versions start a lineage; every later
 * version is a child that names its parent and the explicit change (spec §5.2).
 * The strategy row is locked so version numbers are assigned without races.
 */
export async function createVersion(
  tx: Tx,
  scope: RequestScope,
  strategyId: string,
  body: CreateStrategyVersionRequest,
): Promise<StrategyVersion> {
  const strategy = await loadStrategy(tx, scope, strategyId, true);
  const [agg] = await tx
    .select({ n: max(strategyVersions.versionNumber) })
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategyId));
  const current = agg?.n ?? 0;
  if (body.kind === "ROOT" && current > 0) {
    throw problems.conflict(
      "ROOT_VERSION_EXISTS",
      "this strategy already has a root version; create a child version with an explicit change",
    );
  }
  if (body.kind === "CHILD") {
    const { version: parent } = await loadVersion(tx, scope, body.parentVersionId);
    if (parent.strategyId !== strategyId)
      throw problems.unprocessable(
        "PARENT_NOT_IN_STRATEGY",
        "parent version belongs to a different strategy",
      );
  }
  const id = uuidv7();
  const [row] = await tx
    .insert(strategyVersions)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      strategyId,
      parentVersionId: body.kind === "CHILD" ? body.parentVersionId : null,
      versionNumber: current + 1,
      state: "HYPOTHESIS_DRAFT",
      symbol: body.symbol,
      timeframe: body.timeframe,
      changeReason: body.changeReason,
      createdBy: scope.principal.userId,
      contaminatedDatasetIds: body.kind === "CHILD" ? body.contaminatedData : [],
    })
    .returning();
  if (!row) throw new Error("version insert returned no row");
  if (body.kind === "CHILD") {
    await tx.insert(strategyLineage).values({
      id: uuidv7(),
      organisationId: scope.principal.organisationId,
      parentVersionId: body.parentVersionId,
      childVersionId: id,
      changeCategories: body.changeCategories,
      changedFields: body.changedFields,
      motivatingEvidenceIds: body.motivatingEvidenceIds,
      contaminatedData: body.contaminatedData,
      reason: body.changeReason,
    });
  }
  await audit(tx, scope, {
    action: "STRATEGY_VERSION_CREATED",
    aggregateType: "STRATEGY_VERSION",
    aggregateId: id,
    newState: {
      versionNumber: current + 1,
      parentVersionId: row.parentVersionId,
      symbol: body.symbol,
      timeframe: body.timeframe,
      state: "HYPOTHESIS_DRAFT",
    },
    reason: body.changeReason,
  });
  await emit(tx, scope, {
    eventType: "strategy_version.created",
    aggregateType: "STRATEGY_VERSION",
    aggregateId: id,
    payload: { strategyVersionId: id, strategyId },
  });
  return toVersion(row, strategy);
}

export async function getVersion(
  ctx: AppContext,
  scope: RequestScope,
  id: string,
): Promise<StrategyVersion> {
  const { version, strategy } = await loadVersion(ctx.db, scope, id);
  return toVersion(version, strategy);
}

export async function getLineage(
  ctx: AppContext,
  scope: RequestScope,
  id: string,
): Promise<LineageNode[]> {
  const { strategy } = await loadVersion(ctx.db, scope, id);
  const versions = await ctx.db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategy.id))
    .orderBy(asc(strategyVersions.versionNumber));
  const edges = await ctx.db
    .select()
    .from(strategyLineage)
    .where(eq(strategyLineage.organisationId, scope.principal.organisationId));
  const byChild = new Map(edges.map((e) => [e.childVersionId, e]));
  return versions.map((v) => {
    const edge = byChild.get(v.id);
    return {
      versionId: v.id,
      parentVersionId: v.parentVersionId,
      versionNumber: v.versionNumber,
      state: v.state,
      changeReason: v.changeReason,
      changeCategories: edge?.changeCategories ?? [],
      changedFields: edge?.changedFields ?? [],
      motivatingEvidenceIds: edge?.motivatingEvidenceIds ?? [],
      contaminatedData: edge?.contaminatedData ?? [],
      definitionHash: v.definitionHash,
      pineSourceHash: v.pineSourceHash,
      manifestHash: v.manifestHash,
      createdAt: iso(v.createdAt),
    };
  });
}

function versionBase(scope: RequestScope, version: VersionRow, strategy: StrategyRow): string {
  return objectPaths.version({
    orgId: scope.principal.organisationId,
    campaignId: strategy.campaignId,
    strategyId: strategy.id,
    versionId: version.id,
  });
}

export async function putDefinition(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  versionId: string,
  definition: StrategyDefinition,
): Promise<StrategyDefinitionRecord> {
  const { version, strategy } = await loadVersion(tx, scope, versionId, true);
  if (version.definitionHash || version.lockedAt) {
    throw problems.conflict(
      "DEFINITION_IMMUTABLE",
      "this version already has a definition; create a child version to change it",
    );
  }
  if (version.state !== "HYPOTHESIS_DRAFT")
    throw problems.conflict(
      "INVALID_STATE",
      "definitions can only be attached in HYPOTHESIS_DRAFT",
    );
  if (
    !definition.market.symbols.includes(version.symbol) ||
    definition.market.timeframe !== version.timeframe
  ) {
    throw problems.unprocessable(
      "DEFINITION_IDENTITY_MISMATCH",
      `definition must target ${version.symbol} on timeframe ${version.timeframe}`,
    );
  }
  const bytes = utf8(canonicalJson(definition));
  const hash = sha256Hex(bytes);
  const artefact = await storeArtefact(tx, ctx.store, {
    organisationId: scope.principal.organisationId,
    kind: "SDL_DOCUMENT",
    key: objectPaths.sdl(versionBase(scope, version, strategy), hash),
    bytes,
    contentType: "application/json",
    createdBy: scope.principal.userId,
  });
  const id = uuidv7();
  const [row] = await tx
    .insert(strategyDefinitions)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      strategyVersionId: versionId,
      schemaVersion: definition.schemaVersion,
      content: definition,
      contentHash: hash,
      artefactId: artefact.id,
      createdBy: scope.principal.userId,
    })
    .returning();
  if (!row) throw new Error("definition insert returned no row");
  await tx
    .update(strategyVersions)
    .set({ definitionHash: hash, updatedAt: new Date() })
    .where(eq(strategyVersions.id, versionId));
  await audit(tx, scope, {
    action: "STRATEGY_DEFINITION_STORED",
    aggregateType: "STRATEGY_VERSION",
    aggregateId: versionId,
    priorState: { definitionHash: null },
    newState: { definitionHash: hash, definitionId: id, artefactId: artefact.id },
    reason: "SDL attached",
  });
  return toDefinitionRecord(row);
}

function toDefinitionRecord(
  row: typeof strategyDefinitions.$inferSelect,
): StrategyDefinitionRecord {
  return {
    id: row.id,
    strategyVersionId: row.strategyVersionId,
    schemaVersion: row.schemaVersion,
    contentHash: row.contentHash,
    artefactId: row.artefactId,
    definition: StrategyDefinitionSchema.parse(row.content),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

export async function getDefinition(
  ctx: AppContext,
  scope: RequestScope,
  versionId: string,
): Promise<StrategyDefinitionRecord> {
  await loadVersion(ctx.db, scope, versionId);
  const [row] = await ctx.db
    .select()
    .from(strategyDefinitions)
    .where(eq(strategyDefinitions.strategyVersionId, versionId));
  if (!row) throw problems.notFound("strategy definition");
  return toDefinitionRecord(row);
}

/** Render the approved Pine template and manifest from the stored SDL. Nothing is stored. */
export async function pineTemplate(
  ctx: AppContext,
  scope: RequestScope,
  versionId: string,
  q: { initialCapital: number; currency: string },
): Promise<{
  manifest: PineManifest;
  source: string;
  sourceHash: string;
  manifestHash: string;
  lint: PineLintResult;
}> {
  const { version, strategy } = await loadVersion(ctx.db, scope, versionId);
  const definition = await getDefinition(ctx, scope, versionId);
  const manifest = manifestFromDefinition(definition.definition, {
    strategyId: strategy.id,
    strategyVersionId: version.id,
    campaignId: strategy.campaignId,
    parentVersionId: version.parentVersionId,
    sdlHash: definition.contentHash,
    symbol: version.symbol,
    timeframe: version.timeframe,
    initialCapital: q.initialCapital,
    currency: q.currency,
  });
  const rendered = renderTrendPullbackTemplate(definition.definition, manifest);
  if (!rendered.ok) throw problems.unprocessable(rendered.error.code, rendered.error.detail);
  return {
    manifest,
    source: rendered.value,
    sourceHash: pineSourceHash(rendered.value),
    manifestHash: pineManifestHash(manifest),
    lint: lintPine(rendered.value, manifest),
  };
}

export async function putPineRevision(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  versionId: string,
  body: PutPineRevisionRequest,
): Promise<PineRevisionRecord> {
  const { version, strategy } = await loadVersion(tx, scope, versionId, true);
  if (version.pineSourceHash || version.lockedAt) {
    throw problems.conflict(
      "PINE_IMMUTABLE",
      "this version already has a Pine revision; create a child version to change the source",
    );
  }
  if (version.state !== "PINE_DEVELOPMENT")
    throw problems.conflict(
      "INVALID_STATE",
      "Pine revisions can only be attached in PINE_DEVELOPMENT",
    );
  const [definition] = await tx
    .select()
    .from(strategyDefinitions)
    .where(eq(strategyDefinitions.strategyVersionId, versionId));
  if (!definition)
    throw problems.unprocessable("DEFINITION_REQUIRED", "attach an SDL before the Pine revision");

  const m = body.manifest;
  const identityMismatches = [
    m.strategyVersionId !== version.id && "strategyVersionId",
    m.strategyId !== strategy.id && "strategyId",
    m.campaignId !== strategy.campaignId && "campaignId",
    m.parentVersionId !== version.parentVersionId && "parentVersionId",
    m.symbol !== version.symbol && "symbol",
    m.timeframe !== version.timeframe && "timeframe",
    m.sdlHash !== definition.contentHash && "sdlHash",
  ].filter((x): x is string => typeof x === "string");
  if (identityMismatches.length > 0) {
    throw problems.unprocessable(
      "MANIFEST_IDENTITY_MISMATCH",
      `manifest does not match this version: ${identityMismatches.join(", ")}`,
    );
  }
  const sdl = StrategyDefinitionSchema.parse(definition.content);
  const sdlParams = canonicalJson(sdl.parameters.map((p) => p.key).sort());
  const manifestParams = canonicalJson(m.inputs.map((i) => i.key).sort());
  if (sdlParams !== manifestParams) {
    throw problems.unprocessable(
      "MANIFEST_SDL_MISMATCH",
      "manifest inputs must be exactly the SDL parameters; undeclared parameters are not allowed",
    );
  }

  const source = normalisePineSource(body.source);
  const lint = lintPine(source, m);
  if (lint.status === "FAIL") {
    throw problems.unprocessable(
      "PINE_LINT_FAILED",
      `Pine lint found ${lint.findings.filter((f) => f.severity === "ERROR").length} hard errors`,
      lint.findings
        .filter((f) => f.severity === "ERROR")
        .map((f) => ({
          path: f.line ? `line ${f.line}` : "source",
          message: `${f.rule}: ${f.message}`,
          code: f.rule,
        })),
    );
  }
  const sourceHash = pineSourceHash(source);
  const manifestHash = pineManifestHash(m);
  const base = versionBase(scope, version, strategy);
  const sourceArtefact = await storeArtefact(tx, ctx.store, {
    organisationId: scope.principal.organisationId,
    kind: "PINE_SOURCE",
    key: objectPaths.pineSource(base, sourceHash),
    bytes: utf8(source),
    contentType: "text/plain; charset=utf-8",
    createdBy: scope.principal.userId,
  });
  const manifestBytes = utf8(canonicalJson(m));
  const manifestArtefact = await storeArtefact(tx, ctx.store, {
    organisationId: scope.principal.organisationId,
    kind: "PINE_MANIFEST",
    key: objectPaths.pineManifest(base, manifestHash),
    bytes: manifestBytes,
    contentType: "application/json",
    createdBy: scope.principal.userId,
  });
  const id = uuidv7();
  const [row] = await tx
    .insert(pineRevisions)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      strategyVersionId: versionId,
      sourceHash,
      manifest: m,
      manifestHash,
      pineVersion: m.pineVersion,
      lint,
      lintStatus: lint.status,
      sourceArtefactId: sourceArtefact.id,
      manifestArtefactId: manifestArtefact.id,
      createdBy: scope.principal.userId,
    })
    .returning();
  if (!row) throw new Error("pine revision insert returned no row");
  await tx
    .update(strategyVersions)
    .set({ pineSourceHash: sourceHash, manifestHash, updatedAt: new Date() })
    .where(eq(strategyVersions.id, versionId));
  await audit(tx, scope, {
    action: "PINE_REVISION_STORED",
    aggregateType: "STRATEGY_VERSION",
    aggregateId: versionId,
    priorState: { pineSourceHash: null, manifestHash: null },
    newState: {
      pineSourceHash: sourceHash,
      manifestHash,
      pineRevisionId: id,
      lintStatus: lint.status,
    },
    reason: "Pine revision attached",
  });
  return { ...toPineRecordBase(row), source };
}

function toPineRecordBase(
  row: typeof pineRevisions.$inferSelect,
): Omit<PineRevisionRecord, "source"> {
  return {
    id: row.id,
    strategyVersionId: row.strategyVersionId,
    sourceHash: row.sourceHash,
    manifestHash: row.manifestHash,
    pineVersion: row.pineVersion,
    lintStatus: row.lintStatus,
    lint: PineLintResultSchema.parse(row.lint),
    manifest: PineManifestSchema.parse(row.manifest),
    artefactId: row.sourceArtefactId,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

export async function getPineRevision(
  ctx: AppContext,
  scope: RequestScope,
  versionId: string,
): Promise<PineRevisionRecord> {
  await loadVersion(ctx.db, scope, versionId);
  const [row] = await ctx.db
    .select()
    .from(pineRevisions)
    .where(eq(pineRevisions.strategyVersionId, versionId));
  if (!row) throw problems.notFound("Pine revision");
  const [artefact] = await ctx.db
    .select()
    .from(artefacts)
    .where(eq(artefacts.id, row.sourceArtefactId));
  const bytes = artefact ? await ctx.store.get(artefact.objectKey) : null;
  if (!bytes) throw new Error("Pine source artefact is missing from object storage");
  const source = new TextDecoder().decode(bytes);
  if (pineSourceHash(source) !== row.sourceHash)
    throw new Error("Pine source artefact does not match its recorded hash");
  return { ...toPineRecordBase(row), source };
}

import { z } from "zod";
import { ChangeCategorySchema, LintStatusSchema, WorkflowStateSchema, ParityStatusSchema, DecisionTypeSchema } from "./enums";
import { Sha256HexSchema, TimeframeSchema, TradingViewSymbolSchema, UtcTimestampSchema, DecimalStringSchema } from "./common";
import { StrategyDefinitionSchema } from "./sdl";
import { PineLintResultSchema, PineManifestSchema } from "./pine";

export const CreateStrategyRequestSchema = z
  .object({
    campaignId: z.uuid(),
    name: z.string().trim().min(3).max(120),
    family: z.string().regex(/^[a-z][a-z0-9_]*$/),
    ideaCardId: z.uuid().optional(),
  })
  .strict();
export type CreateStrategyRequest = z.infer<typeof CreateStrategyRequestSchema>;

export const StrategySchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  name: z.string(),
  family: z.string(),
  ideaCardId: z.uuid().nullable(),
  createdBy: z.uuid(),
  createdAt: UtcTimestampSchema,
});
export type Strategy = z.infer<typeof StrategySchema>;

/**
 * Root version: no parent. Child version: parent plus an explicit change
 * description (spec §5.2). Symbol and timeframe are part of version identity.
 */
export const CreateStrategyVersionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ROOT"),
      symbol: TradingViewSymbolSchema,
      timeframe: TimeframeSchema,
      changeReason: z.string().trim().min(3).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("CHILD"),
      parentVersionId: z.uuid(),
      symbol: TradingViewSymbolSchema,
      timeframe: TimeframeSchema,
      changeReason: z.string().trim().min(3).max(1000),
      changeCategories: z.array(ChangeCategorySchema).min(1),
      changedFields: z.array(z.string().min(1)).min(1),
      motivatingEvidenceIds: z.array(z.uuid()),
      contaminatedData: z.array(z.string().min(1)),
    })
    .strict(),
]);
export type CreateStrategyVersionRequest = z.infer<typeof CreateStrategyVersionRequestSchema>;

export const StrategyVersionSchema = z.object({
  id: z.uuid(),
  strategyId: z.uuid(),
  strategyName: z.string(),
  campaignId: z.uuid(),
  parentVersionId: z.uuid().nullable(),
  versionNumber: z.number().int().positive(),
  state: WorkflowStateSchema,
  symbol: z.string(),
  timeframe: z.string(),
  definitionHash: Sha256HexSchema.nullable(),
  pineSourceHash: Sha256HexSchema.nullable(),
  manifestHash: Sha256HexSchema.nullable(),
  changeReason: z.string(),
  createdBy: z.uuid(),
  lockedAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
});
export type StrategyVersion = z.infer<typeof StrategyVersionSchema>;

export const PutStrategyDefinitionRequestSchema = z
  .object({ definition: StrategyDefinitionSchema })
  .strict();

export const StrategyDefinitionRecordSchema = z.object({
  id: z.uuid(),
  strategyVersionId: z.uuid(),
  schemaVersion: z.string(),
  contentHash: Sha256HexSchema,
  artefactId: z.uuid(),
  definition: StrategyDefinitionSchema,
  createdBy: z.uuid(),
  createdAt: UtcTimestampSchema,
});
export type StrategyDefinitionRecord = z.infer<typeof StrategyDefinitionRecordSchema>;

export const PutPineRevisionRequestSchema = z
  .object({
    source: z.string().min(20).max(500_000),
    manifest: PineManifestSchema,
  })
  .strict();
export type PutPineRevisionRequest = z.infer<typeof PutPineRevisionRequestSchema>;

export const PineRevisionRecordSchema = z.object({
  id: z.uuid(),
  strategyVersionId: z.uuid(),
  sourceHash: Sha256HexSchema,
  manifestHash: Sha256HexSchema,
  pineVersion: z.number().int(),
  lintStatus: LintStatusSchema,
  lint: PineLintResultSchema,
  manifest: PineManifestSchema,
  source: z.string(),
  artefactId: z.uuid(),
  createdBy: z.uuid(),
  createdAt: UtcTimestampSchema,
});
export type PineRevisionRecord = z.infer<typeof PineRevisionRecordSchema>;

export const LineageNodeSchema = z.object({
  versionId: z.uuid(),
  parentVersionId: z.uuid().nullable(),
  versionNumber: z.number().int(),
  state: WorkflowStateSchema,
  changeReason: z.string(),
  changeCategories: z.array(ChangeCategorySchema),
  changedFields: z.array(z.string()),
  motivatingEvidenceIds: z.array(z.string()),
  contaminatedData: z.array(z.string()),
  definitionHash: Sha256HexSchema.nullable(),
  pineSourceHash: Sha256HexSchema.nullable(),
  manifestHash: Sha256HexSchema.nullable(),
  createdAt: UtcTimestampSchema,
});
export type LineageNode = z.infer<typeof LineageNodeSchema>;

export const TransitionRequestSchema = z
  .object({
    to: WorkflowStateSchema,
    reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1),
    summary: z.string().trim().min(3).max(2000),
    evidenceIds: z.array(z.uuid()),
  })
  .strict();
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

/** Denormalised Strategy Library row (read model). */
export const StrategyLibraryRowSchema = z.object({
  strategyVersionId: z.uuid(),
  strategyId: z.uuid(),
  campaignId: z.uuid(),
  strategyName: z.string(),
  family: z.string(),
  versionNumber: z.number().int(),
  state: WorkflowStateSchema,
  assetClass: z.string().nullable(),
  symbol: z.string(),
  timeframe: z.string(),
  parityStatus: ParityStatusSchema.nullable(),
  closedTradeCount: z.number().int().nullable(),
  netProfit: DecimalStringSchema.nullable(),
  maxDrawdownPct: DecimalStringSchema.nullable(),
  profitFactor: DecimalStringSchema.nullable(),
  lastDecision: DecisionTypeSchema.nullable(),
  updatedAt: UtcTimestampSchema,
});
export type StrategyLibraryRow = z.infer<typeof StrategyLibraryRowSchema>;

export const StrategyLibraryQuerySchema = z.object({
  state: z.string().optional(),
  assetClass: z.string().optional(),
  timeframe: z.string().optional(),
  parityStatus: z.string().optional(),
  updatedAfter: z.iso.datetime({ offset: false }).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

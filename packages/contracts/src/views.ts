import { z } from "zod";
import { DecimalStringSchema, Sha256HexSchema, UtcTimestampSchema } from "./common";
import { AuditEventSchema } from "./audit";
import { DecisionSchema, EvidenceSnapshotSchema } from "./decision";
import { JobStatusSchema, RunnerTypeSchema, VerificationStatusSchema, WorkflowStateSchema, ActorTypeSchema } from "./enums";
import { PineLintResultSchema, PineManifestSchema } from "./pine";
import { StrategyLibraryRowSchema, StrategySchema, StrategyVersionSchema } from "./strategy";

/**
 * Read-model response contracts for API views that are not single domain
 * records. The web app validates responses against these; nothing else
 * redefines their shape. Version 1.0.0.
 */
export const CommandCentreViewSchema = z.object({
  generatedAt: UtcTimestampSchema,
  activeCampaigns: z.number().int(),
  versionCountsByState: z.record(z.string(), z.number().int()),
  awaitingDecision: z.array(StrategyLibraryRowSchema),
  openVerifications: z.array(z.object({ id: z.uuid(), strategyVersionId: z.uuid(), status: VerificationStatusSchema, updatedAt: UtcTimestampSchema })),
  failedJobs: z.array(
    z.object({
      jobKey: z.string(),
      jobName: z.string(),
      status: JobStatusSchema,
      attempts: z.number().int(),
      lastErrorCode: z.string().nullable(),
      verificationId: z.uuid().nullable(),
      updatedAt: UtcTimestampSchema,
    }),
  ),
  recentActivity: z.array(AuditEventSchema),
});
export type CommandCentreView = z.infer<typeof CommandCentreViewSchema>;

export const StrategyWithVersionsSchema = z.object({ strategy: StrategySchema, versions: z.array(StrategyVersionSchema) });
export type StrategyWithVersions = z.infer<typeof StrategyWithVersionsSchema>;

export const PineTemplateViewSchema = z.object({
  manifest: PineManifestSchema,
  source: z.string(),
  sourceHash: Sha256HexSchema,
  manifestHash: Sha256HexSchema,
  lint: PineLintResultSchema,
});
export type PineTemplateView = z.infer<typeof PineTemplateViewSchema>;

export const TransitionRecordSchema = z.object({
  id: z.uuid(),
  fromState: WorkflowStateSchema,
  toState: WorkflowStateSchema,
  reasonCodes: z.array(z.string()),
  summary: z.string(),
  evidenceIds: z.array(z.string()),
  policyVersion: z.string(),
  actorType: ActorTypeSchema,
  actorId: z.string(),
  humanOverride: z.boolean(),
  overrideReason: z.string().nullable(),
  createdAt: UtcTimestampSchema,
});
export type TransitionRecord = z.infer<typeof TransitionRecordSchema>;

export const TransitionResultSchema = z.object({
  transitionId: z.uuid(),
  from: WorkflowStateSchema,
  to: WorkflowStateSchema,
  ruleId: z.string(),
  policyVersion: z.string(),
  replayed: z.boolean(),
});

export const BacktestRunViewSchema = z.object({
  id: z.uuid(),
  strategyVersionId: z.uuid(),
  verificationId: z.uuid().nullable(),
  runnerType: RunnerTypeSchema,
  runnerVersion: z.string(),
  evidenceLabel: z.literal("HISTORICAL_SIMULATED"),
  sourceHash: Sha256HexSchema,
  manifestHash: Sha256HexSchema,
  settingsHash: Sha256HexSchema,
  environmentHash: Sha256HexSchema,
  symbol: z.string(),
  timeframe: z.string(),
  initialCapital: DecimalStringSchema,
  currency: z.string(),
  parsers: z.unknown(),
  warnings: z.unknown(),
  status: JobStatusSchema,
  errorCode: z.string().nullable(),
  startedAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.nullable(),
});
export type BacktestRunView = z.infer<typeof BacktestRunViewSchema>;

export const DecisionContextSchema = z.object({
  evidence: EvidenceSnapshotSchema,
  overridableWarnings: z.array(z.string()),
  decision: DecisionSchema.nullable(),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;

export const AuditChainStatusSchema = z.object({ valid: z.boolean(), brokenAt: z.uuid().nullable(), count: z.number().int() });

export const GenerateIdeaResultSchema = z.object({ taskId: z.uuid(), agentRunId: z.uuid() });

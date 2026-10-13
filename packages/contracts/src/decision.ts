import { z } from "zod";
import { DecisionTypeSchema, ParityStatusSchema, WorkflowStateSchema } from "./enums";
import { UtcTimestampSchema } from "./common";

export const CreateDecisionRequestSchema = z
  .object({
    strategyVersionId: z.uuid(),
    decision: DecisionTypeSchema,
    reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1),
    summary: z.string().trim().min(10).max(4000),
    /** The strongest case for rejecting this version. Mandatory for every decision. */
    rejectionCase: z.string().trim().min(10).max(4000),
    parityReportId: z.uuid().nullable(),
    humanOverride: z.boolean().default(false),
    overrideReason: z.string().trim().min(10).max(2000).optional(),
    acknowledgement: z.literal(true),
  })
  .strict()
  .refine((d) => !d.humanOverride || d.overrideReason !== undefined, {
    path: ["overrideReason"],
    message: "overrideReason is required when humanOverride is true",
  });
export type CreateDecisionRequest = z.infer<typeof CreateDecisionRequestSchema>;

export const EvidenceSnapshotSchema = z.object({
  strategyVersionId: z.uuid(),
  state: WorkflowStateSchema,
  definitionHash: z.string().nullable(),
  pineSourceHash: z.string().nullable(),
  manifestHash: z.string().nullable(),
  verificationId: z.uuid().nullable(),
  backtestRunId: z.uuid().nullable(),
  parityReportId: z.uuid().nullable(),
  parityStatus: ParityStatusSchema.nullable(),
  closedTradeCount: z.number().int().nullable(),
  hardFailures: z.array(z.string()),
  warnings: z.array(z.string()),
  missingEvidence: z.array(z.string()),
});
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;

export const DecisionSchema = z.object({
  id: z.uuid(),
  strategyVersionId: z.uuid(),
  decision: DecisionTypeSchema,
  reasonCodes: z.array(z.string()),
  summary: z.string(),
  rejectionCase: z.string(),
  parityReportId: z.uuid().nullable(),
  evidence: EvidenceSnapshotSchema,
  policyVersion: z.string(),
  humanOverride: z.boolean(),
  overrideReason: z.string().nullable(),
  decidedBy: z.uuid(),
  createdAt: UtcTimestampSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

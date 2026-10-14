import { z } from "zod";
import { ActorTypeSchema, AggregateTypeSchema } from "./enums";
import { UtcTimestampSchema } from "./common";

export const AuditActionSchema = z.enum([
  "CAMPAIGN_CREATED",
  "RESEARCH_TASK_CREATED",
  "IDEA_CARD_CREATED",
  "AGENT_RUN_RECORDED",
  "STRATEGY_CREATED",
  "STRATEGY_VERSION_CREATED",
  "STRATEGY_DEFINITION_STORED",
  "PINE_REVISION_STORED",
  "STATE_TRANSITIONED",
  "VERIFICATION_CREATED",
  "REPORT_UPLOAD_REQUESTED",
  "REPORT_UPLOAD_COMPLETED",
  "REPORT_PARSED",
  "REPORT_PARSE_FAILED",
  "BACKTEST_RUN_RECORDED",
  "PARITY_REPORT_CREATED",
  "DECISION_RECORDED",
  "HUMAN_OVERRIDE",
  "PROTECTED_ARTEFACT_READ",
  "EXTERNAL_EVIDENCE_IMPORTED",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEventSchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  actorType: ActorTypeSchema,
  actorId: z.string(),
  action: AuditActionSchema,
  aggregateType: AggregateTypeSchema,
  aggregateId: z.uuid(),
  priorState: z.record(z.string(), z.unknown()).nullable(),
  newState: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string(),
  traceId: z.string(),
  hash: z.string(),
  prevHash: z.string().nullable(),
  createdAt: UtcTimestampSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

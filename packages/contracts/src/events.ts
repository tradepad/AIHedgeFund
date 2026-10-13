import { z } from "zod";
import { ActorTypeSchema, AggregateTypeSchema } from "./enums";
import { UtcTimestampSchema } from "./common";

/** Domain events published through the transactional outbox (spec §14.8). */
export const DomainEventTypeSchema = z.enum([
  "campaign.created",
  "research_task.created",
  "agent_run.requested",
  "agent_run.completed",
  "strategy_version.created",
  "strategy_version.transitioned",
  "verification.created",
  "report_upload.completed",
  "report.parsed",
  "verification.reports_parsed",
  "trades.normalised",
  "equity.reconstructed",
  "metrics.calculated",
  "parity.calculated",
  "committee_decision.created",
]);
export type DomainEventType = z.infer<typeof DomainEventTypeSchema>;

export const ActorRefSchema = z.object({ type: ActorTypeSchema, id: z.string() });
export type ActorRef = z.infer<typeof ActorRefSchema>;

export const DomainEventSchema = z.object({
  eventId: z.uuid(),
  eventType: DomainEventTypeSchema,
  eventVersion: z.number().int().positive(),
  organisationId: z.uuid(),
  aggregateType: AggregateTypeSchema,
  aggregateId: z.uuid(),
  correlationId: z.string(),
  causationId: z.string().nullable(),
  actor: ActorRefSchema,
  occurredAt: UtcTimestampSchema,
  traceId: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

/** Payload contracts per event type, validated by consumers. */
export const EventPayloads = {
  "report_upload.completed": z.object({ verificationId: z.uuid(), uploadId: z.uuid() }),
  "verification.reports_parsed": z.object({ verificationId: z.uuid() }),
  "trades.normalised": z.object({ verificationId: z.uuid(), backtestRunId: z.uuid() }),
  "equity.reconstructed": z.object({ verificationId: z.uuid(), backtestRunId: z.uuid() }),
  "metrics.calculated": z.object({ verificationId: z.uuid(), backtestRunId: z.uuid() }),
  "parity.calculated": z.object({ verificationId: z.uuid(), backtestRunId: z.uuid(), parityReportId: z.uuid() }),
  "agent_run.requested": z.object({ taskId: z.uuid(), agentRunId: z.uuid() }),
  "agent_run.completed": z.object({ taskId: z.uuid(), agentRunId: z.uuid(), ideaCardId: z.uuid().nullable() }),
} as const;

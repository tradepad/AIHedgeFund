import { z } from "zod";
import { DomainEventTypeSchema, type DomainEvent, type DomainEventType } from "@arf/contracts";

export const QUEUES = {
  backtest: "arf-backtest",
  analytics: "arf-analytics",
  research: "arf-research",
  orchestrator: "arf-orchestrator",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_NAMES = [
  "report.parse",
  "trades.normalise",
  "equity.reconstruct",
  "metrics.calculate",
  "parity.calculate",
  "read_model.refresh",
  "agent.run",
  "orchestrator.agent_run_completed",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** Every job carries the triggering event so handlers stay correlated and idempotent. */
export const JobPayloadSchema = z.object({
  eventId: z.uuid(),
  eventType: DomainEventTypeSchema,
  organisationId: z.uuid(),
  aggregateId: z.uuid(),
  correlationId: z.string(),
  traceId: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type JobPayload = z.infer<typeof JobPayloadSchema>;

export interface JobRoute {
  queue: QueueName;
  name: JobName;
}

/**
 * Event → job routing. A pure table so the pipeline is reviewable in one
 * place: parse → normalise → equity → metrics → parity → read model.
 */
export const EVENT_ROUTES: Partial<Record<DomainEventType, readonly JobRoute[]>> = {
  "report_upload.completed": [{ queue: QUEUES.backtest, name: "report.parse" }],
  "verification.reports_parsed": [{ queue: QUEUES.backtest, name: "trades.normalise" }],
  "trades.normalised": [{ queue: QUEUES.analytics, name: "equity.reconstruct" }],
  "equity.reconstructed": [{ queue: QUEUES.analytics, name: "metrics.calculate" }],
  "metrics.calculated": [{ queue: QUEUES.analytics, name: "parity.calculate" }],
  "parity.calculated": [{ queue: QUEUES.analytics, name: "read_model.refresh" }],
  "strategy_version.created": [{ queue: QUEUES.analytics, name: "read_model.refresh" }],
  "strategy_version.transitioned": [{ queue: QUEUES.analytics, name: "read_model.refresh" }],
  "committee_decision.created": [{ queue: QUEUES.analytics, name: "read_model.refresh" }],
  "agent_run.requested": [{ queue: QUEUES.research, name: "agent.run" }],
  "agent_run.completed": [{ queue: QUEUES.orchestrator, name: "orchestrator.agent_run_completed" }],
};

export function routesFor(event: DomainEvent): readonly JobRoute[] {
  return EVENT_ROUTES[event.eventType] ?? [];
}

/** Deterministic job id: re-publishing the same event never enqueues a duplicate job. BullMQ forbids ':' in ids. */
export function jobIdFor(event: DomainEvent, route: JobRoute): string {
  return `${route.name.replace(/\./g, "_")}__${event.eventId}`;
}

export function toJobPayload(event: DomainEvent): JobPayload {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    organisationId: event.organisationId,
    aggregateId: event.aggregateId,
    correlationId: event.correlationId,
    traceId: event.traceId,
    payload: event.payload,
  };
}

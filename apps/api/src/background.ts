import type { Worker } from "bullmq";
import { EventPayloads } from "@arf/contracts";
import { dispatchOutboxBatch, type Database } from "@arf/db";
import { QUEUES, redisConnection, startWorker, tracked, type EventBus } from "@arf/event-bus";
import type { Logger } from "@arf/observability";
import type { WorkflowEngine } from "@arf/workflow";

const ORCHESTRATOR_ACTOR = { type: "SERVICE" as const, id: "service:orchestrator", roles: ["SERVICE_ACCOUNT" as const] };

/**
 * Transactional-outbox relay. Rows are committed with the state change that
 * produced them and published here with deterministic job ids, so a crash
 * between publish and acknowledgement only causes a harmless re-publish.
 */
export function startOutboxRelay(db: Database, bus: EventBus, logger: Logger, intervalMs = 500): () => Promise<void> {
  let running = true;
  let inFlight: Promise<void> = Promise.resolve();
  const loop = async (): Promise<void> => {
    while (running) {
      try {
        const { dispatched, failed } = await dispatchOutboxBatch(db, async (event) => {
          await bus.publish(event);
        });
        if (failed > 0) logger.warn({ failed }, "outbox dispatch failures");
        if (dispatched === 0) await new Promise((r) => setTimeout(r, intervalMs));
      } catch (error) {
        logger.error({ err: error }, "outbox relay error");
        await new Promise((r) => setTimeout(r, intervalMs * 4));
      }
    }
  };
  inFlight = loop();
  return async () => {
    running = false;
    await inFlight;
  };
}

/**
 * Orchestrator: applies lifecycle transitions that follow from worker results.
 * Workers never change state themselves (CLAUDE.md §3.2); they emit events and
 * this service asks the workflow engine, which enforces the policy.
 */
export function startOrchestrator(db: Database, workflow: WorkflowEngine, redisUrl: string, logger: Logger): Worker {
  return startWorker(QUEUES.orchestrator, redisConnection(redisUrl), {
    "orchestrator.agent_run_completed": tracked(db, logger, QUEUES.orchestrator, () => ({}), async ({ payload }) => {
      const data = EventPayloads["agent_run.completed"].parse(payload.payload);
      const to = data.ideaCardId ? "HYPOTHESIS_DRAFT" : "BLOCKED";
      const result = await db.transaction((tx) =>
        workflow.transition(tx, {
          organisationId: payload.organisationId,
          aggregate: "RESEARCH_TASK",
          aggregateId: data.taskId,
          from: "IDEA_RESEARCH",
          to,
          actor: ORCHESTRATOR_ACTOR,
          reasonCodes: [data.ideaCardId ? "IDEA_CARD_VALIDATED" : "AGENT_OUTPUT_INVALID"],
          summary: data.ideaCardId ? "validated IDEA_SCOUT output recorded" : "IDEA_SCOUT output failed validation",
          evidenceIds: data.ideaCardId ? [data.ideaCardId] : [],
          transitionKey: `orchestrator__${payload.eventId}`,
          traceId: payload.traceId,
          correlationId: payload.correlationId,
        }),
      );
      if (!result.ok && result.error.code !== "STALE_STATE") {
        throw new Error(`orchestrator transition rejected: ${result.error.code}`);
      }
    }),
  });
}

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { uuidv7, type ActorRef, type AggregateType, type DomainEvent, type DomainEventType } from "@arf/contracts";
import { outboxEvents } from "./schema";
import type { Database, DbOrTx } from "./client";

export interface OutboxInput {
  organisationId: string;
  eventType: DomainEventType;
  eventVersion?: number;
  aggregateType: AggregateType;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  actor: ActorRef;
  traceId: string;
  payload: Record<string, unknown>;
  /** Deterministic id for idempotent producers (e.g. jobs that may retry). */
  eventId?: string;
}

/** Record a domain event in the same transaction as the state change that caused it. */
export async function enqueueOutbox(tx: DbOrTx, input: OutboxInput): Promise<string> {
  const id = input.eventId ?? uuidv7();
  await tx
    .insert(outboxEvents)
    .values({
      id,
      organisationId: input.organisationId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      correlationId: input.correlationId,
      causationId: input.causationId,
      actor: input.actor,
      payload: input.payload,
      traceId: input.traceId,
    })
    .onConflictDoNothing();
  return id;
}

export function toDomainEvent(row: typeof outboxEvents.$inferSelect): DomainEvent {
  return {
    eventId: row.id,
    eventType: row.eventType as DomainEventType,
    eventVersion: row.eventVersion,
    organisationId: row.organisationId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    correlationId: row.correlationId,
    causationId: row.causationId,
    actor: row.actor as ActorRef,
    occurredAt: row.createdAt.toISOString(),
    traceId: row.traceId,
    payload: row.payload as Record<string, unknown>,
  };
}

/**
 * Claim and dispatch pending outbox rows. `publish` must be idempotent on
 * eventId (BullMQ jobId = eventId), because a crash after publish but before
 * the row is marked dispatched causes a re-publish.
 */
export async function dispatchOutboxBatch(
  db: Database,
  publish: (event: DomainEvent) => Promise<void>,
  batchSize = 50,
): Promise<{ dispatched: number; failed: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.dispatchedAt))
      .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    let dispatched = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await publish(toDomainEvent(row));
        await tx
          .update(outboxEvents)
          .set({ dispatchedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1`, lastError: null })
          .where(and(eq(outboxEvents.id, row.id)));
        dispatched += 1;
      } catch (error) {
        failed += 1;
        await tx
          .update(outboxEvents)
          .set({
            attempts: sql`${outboxEvents.attempts} + 1`,
            lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
          })
          .where(eq(outboxEvents.id, row.id));
      }
    }
    return { dispatched, failed };
  });
}

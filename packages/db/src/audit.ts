import { sql, desc, eq } from "drizzle-orm";
import {
  canonicalJson,
  uuidv7,
  type ActorType,
  type AggregateType,
  type AuditAction,
} from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { auditEvents } from "./schema";
import type { DbOrTx } from "./client";

export interface AuditInput {
  organisationId: string;
  actorType: ActorType;
  actorId: string;
  action: AuditAction;
  aggregateType: AggregateType;
  aggregateId: string;
  priorState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  reason: string;
  traceId: string;
}

export function auditHash(
  prevHash: string | null,
  input: AuditInput,
  id: string,
  createdAt: Date,
): string {
  return sha256Hex(
    canonicalJson({
      prevHash,
      id,
      createdAt: createdAt.toISOString(),
      organisationId: input.organisationId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      priorState: input.priorState,
      newState: input.newState,
      reason: input.reason,
      traceId: input.traceId,
    }),
  );
}

/**
 * Append a tamper-evident audit record. Must be called inside the same
 * transaction as the change it records. A per-organisation advisory lock
 * serialises chain appends so `prev_hash` is always the latest record.
 */
export async function appendAudit(
  tx: DbOrTx,
  input: AuditInput,
): Promise<{ id: string; hash: string }> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"audit:" + input.organisationId}, 0))`,
  );
  const [prev] = await tx
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, input.organisationId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const id = uuidv7();
  const createdAt = new Date();
  const prevHash = prev?.hash ?? null;
  const hash = auditHash(prevHash, input, id, createdAt);
  await tx.insert(auditEvents).values({ id, ...input, prevHash, hash, createdAt });
  return { id, hash };
}

/** Recompute the hash chain for an organisation. Returns the first broken record id, if any. */
export async function verifyAuditChain(
  db: DbOrTx,
  organisationId: string,
): Promise<{ valid: boolean; brokenAt: string | null; count: number }> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, organisationId))
    .orderBy(auditEvents.seq);
  let prev: string | null = null;
  for (const row of rows) {
    const expected = auditHash(
      prev,
      {
        organisationId: row.organisationId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        priorState: row.priorState as Record<string, unknown> | null,
        newState: row.newState as Record<string, unknown> | null,
        reason: row.reason,
        traceId: row.traceId,
      },
      row.id,
      row.createdAt,
    );
    if (row.prevHash !== prev || row.hash !== expected)
      return { valid: false, brokenAt: row.id, count: rows.length };
    prev = row.hash;
  }
  return { valid: true, brokenAt: null, count: rows.length };
}

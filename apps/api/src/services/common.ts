import { and, eq } from "drizzle-orm";
import {
  uuidv7,
  type AggregateType,
  type ArtefactKind,
  type AuditAction,
  type DomainEventType,
  type ProtectionLevel,
} from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { appendAudit, artefacts, enqueueOutbox, type DbOrTx } from "@arf/db";
import type { ObjectStore } from "@arf/storage";
import type { RequestScope } from "../context";

export const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");
export const isoOrNull = (d: Date | null): string | null => (d ? iso(d) : null);

export async function audit(
  tx: DbOrTx,
  scope: RequestScope,
  input: {
    action: AuditAction;
    aggregateType: AggregateType;
    aggregateId: string;
    priorState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
    reason: string;
  },
): Promise<void> {
  await appendAudit(tx, {
    organisationId: scope.principal.organisationId,
    actorType: "USER",
    actorId: scope.principal.userId,
    action: input.action,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    priorState: input.priorState ?? null,
    newState: input.newState ?? null,
    reason: input.reason,
    traceId: scope.traceId,
  });
}

export async function emit(
  tx: DbOrTx,
  scope: RequestScope,
  input: {
    eventType: DomainEventType;
    aggregateType: AggregateType;
    aggregateId: string;
    payload: Record<string, unknown>;
    causationId?: string | null;
  },
): Promise<string> {
  return enqueueOutbox(tx, {
    organisationId: scope.principal.organisationId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    correlationId: scope.correlationId,
    causationId: input.causationId ?? null,
    actor: { type: "USER", id: scope.principal.userId },
    traceId: scope.traceId,
    payload: input.payload,
  });
}

/**
 * Store bytes immutably and register (or reuse) the artefact row. Artefacts
 * are content-addressed per organisation and kind, so re-storing identical
 * content returns the existing record.
 */
export async function storeArtefact(
  tx: DbOrTx,
  store: ObjectStore,
  input: {
    organisationId: string;
    kind: ArtefactKind;
    key: string;
    bytes: Uint8Array;
    contentType: string;
    protection?: ProtectionLevel;
    createdBy: string;
  },
): Promise<{ id: string; sha256: string; objectKey: string }> {
  const sha = sha256Hex(input.bytes);
  const [existing] = await tx
    .select()
    .from(artefacts)
    .where(
      and(
        eq(artefacts.organisationId, input.organisationId),
        eq(artefacts.kind, input.kind),
        eq(artefacts.sha256, sha),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, sha256: sha, objectKey: existing.objectKey };
  await store.putImmutable(input.key, input.bytes, input.contentType);
  const id = uuidv7();
  await tx.insert(artefacts).values({
    id,
    organisationId: input.organisationId,
    kind: input.kind,
    objectKey: input.key,
    sha256: sha,
    sizeBytes: input.bytes.byteLength,
    contentType: input.contentType,
    protection: input.protection ?? "STANDARD",
    createdBy: input.createdBy,
  });
  return { id, sha256: sha, objectKey: input.key };
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

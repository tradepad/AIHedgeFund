import { and, eq, lt, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { canonicalJson, uuidv7 } from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { idempotencyRecords, type Tx } from "@arf/db";
import type { AppContext, RequestScope } from "../context";
import { problems } from "./problem";

const STALE_IN_PROGRESS_MS = 60_000;

export interface CommandResult<T> {
  status: number;
  body: T;
}

export function idempotencyKeyOf(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\w.:-]{8,200}$/.test(key)) {
    throw problems.badRequest("IDEMPOTENCY_KEY_REQUIRED", "commands require an Idempotency-Key header (8-200 characters)");
  }
  return key;
}

/**
 * Exactly-once command execution (CLAUDE.md §17.5). The key is reserved
 * first so concurrent duplicates are rejected, then the command and the
 * stored response commit in one transaction. A retry with the same key and
 * body replays the stored response; the same key with a different body is
 * rejected. A reservation abandoned by a crash can be reclaimed after 60s.
 */
export async function runIdempotent<T>(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  scope: RequestScope,
  commandScope: string,
  body: unknown,
  command: (tx: Tx, key: string) => Promise<CommandResult<T>>,
): Promise<T> {
  const key = idempotencyKeyOf(request);
  const orgId = scope.principal.organisationId;
  const actorId = scope.principal.userId;
  const requestHash = sha256Hex(canonicalJson({ commandScope, url: request.url.split("?")[0], body: body ?? null }));
  const identity = and(
    eq(idempotencyRecords.organisationId, orgId),
    eq(idempotencyRecords.actorId, actorId),
    eq(idempotencyRecords.scope, commandScope),
    eq(idempotencyRecords.key, key),
  );

  const inserted = await ctx.db
    .insert(idempotencyRecords)
    .values({ id: uuidv7(), organisationId: orgId, actorId, scope: commandScope, key, requestHash, state: "IN_PROGRESS" })
    .onConflictDoNothing()
    .returning({ id: idempotencyRecords.id });

  if (inserted.length === 0) {
    const [existing] = await ctx.db.select().from(idempotencyRecords).where(identity).limit(1);
    if (!existing) throw problems.conflict("IDEMPOTENCY_IN_PROGRESS", "a request with this key is being processed");
    if (existing.requestHash !== requestHash) {
      throw problems.unprocessable("IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was already used with a different request");
    }
    if (existing.state === "COMPLETED") {
      void reply.status(existing.responseStatus ?? 200).header("idempotency-replayed", "true");
      return existing.responseBody as T;
    }
    const reclaimed = await ctx.db
      .update(idempotencyRecords)
      .set({ createdAt: new Date() })
      .where(and(identity, eq(idempotencyRecords.state, "IN_PROGRESS"), lt(idempotencyRecords.createdAt, new Date(Date.now() - STALE_IN_PROGRESS_MS))))
      .returning({ id: idempotencyRecords.id });
    if (reclaimed.length === 0) throw problems.conflict("IDEMPOTENCY_IN_PROGRESS", "a request with this key is being processed");
  }

  try {
    const result = await ctx.db.transaction(async (tx) => {
      const out = await command(tx, key);
      await tx
        .update(idempotencyRecords)
        .set({ state: "COMPLETED", responseStatus: out.status, responseBody: sql`${JSON.stringify(out.body)}::jsonb`, completedAt: new Date() })
        .where(identity);
      return out;
    });
    void reply.status(result.status);
    return result.body;
  } catch (error) {
    // Release the reservation so the client can correct the request and retry.
    await ctx.db.delete(idempotencyRecords).where(and(identity, eq(idempotencyRecords.state, "IN_PROGRESS")));
    throw error;
  }
}

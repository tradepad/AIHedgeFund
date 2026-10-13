import { eq, sql } from "drizzle-orm";
import { uuidv7, type JobStatus } from "@arf/contracts";
import { jobRuns, type Database } from "@arf/db";
import type { JobPayload } from "./jobs";

/** Domain error class for job failures that must not be retried. */
export class TerminalJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Persist job status so user-visible progress never depends on logs or on
 * Redis retention. Keyed by the deterministic BullMQ job id.
 */
export async function recordJobStart(db: Database, input: { jobKey: string; queue: string; jobName: string; payload: JobPayload; attempt: number; verificationId?: string | null }): Promise<void> {
  const now = new Date();
  await db
    .insert(jobRuns)
    .values({
      id: uuidv7(),
      jobKey: input.jobKey,
      queue: input.queue,
      jobName: input.jobName,
      organisationId: input.payload.organisationId,
      status: "RUNNING",
      attempts: input.attempt,
      correlationId: input.payload.correlationId,
      verificationId: input.verificationId ?? null,
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: jobRuns.jobKey,
      set: { status: "RUNNING", attempts: input.attempt, startedAt: now, updatedAt: now, lastErrorCode: null, lastErrorMessage: null },
    });
}

export async function recordJobEnd(
  db: Database,
  jobKey: string,
  outcome: { status: Extract<JobStatus, "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL">; errorCode?: string; errorMessage?: string; backtestRunId?: string | null },
): Promise<void> {
  const now = new Date();
  await db
    .update(jobRuns)
    .set({
      status: outcome.status,
      lastErrorCode: outcome.errorCode ?? null,
      lastErrorMessage: outcome.errorMessage?.slice(0, 500) ?? null,
      finishedAt: now,
      updatedAt: now,
      durationMs: sql`(extract(epoch from (now() - coalesce(${jobRuns.startedAt}, now()))) * 1000)::int`,
      ...(outcome.backtestRunId ? { backtestRunId: outcome.backtestRunId } : {}),
    })
    .where(eq(jobRuns.jobKey, jobKey));
}

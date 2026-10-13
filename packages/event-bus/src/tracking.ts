import { UnrecoverableError, type Job } from "bullmq";
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
export async function recordJobStart(
  db: Database,
  input: {
    jobKey: string;
    queue: string;
    jobName: string;
    payload: JobPayload;
    attempt: number;
    verificationId?: string | null;
  },
): Promise<void> {
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
      set: {
        status: "RUNNING",
        attempts: input.attempt,
        startedAt: now,
        updatedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
}

export async function recordJobEnd(
  db: Database,
  jobKey: string,
  outcome: {
    status: Extract<JobStatus, "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL">;
    errorCode?: string;
    errorMessage?: string;
    backtestRunId?: string | null;
  },
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

export interface TrackedJobContext {
  jobKey: string;
  attempt: number;
  payload: JobPayload;
}

export interface JobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Wrap a job handler with persisted status, structured logs and retry policy.
 * A TerminalJobError is recorded as FAILED_TERMINAL and converted to BullMQ's
 * UnrecoverableError so it is not retried; any other error is retryable until
 * the attempt budget is spent, then recorded as FAILED_TERMINAL.
 */
export function tracked(
  db: Database,
  logger: JobLogger,
  queue: string,
  resolveIds: (payload: JobPayload) => { verificationId?: string | null },
  handler: (ctx: TrackedJobContext) => Promise<{ backtestRunId?: string | null } | void>,
): (payload: JobPayload, job: Job) => Promise<void> {
  return async (payload, job) => {
    const jobKey = job.id ?? `${job.name}__${payload.eventId}`;
    const attempt = job.attemptsMade + 1;
    const started = Date.now();
    const ids = resolveIds(payload);
    const base = {
      jobKey,
      jobName: job.name,
      queue,
      traceId: payload.traceId,
      correlationId: payload.correlationId,
      organisationId: payload.organisationId,
      verificationId: ids.verificationId ?? null,
      attempt,
    };
    await recordJobStart(db, {
      jobKey,
      queue,
      jobName: job.name,
      payload,
      attempt,
      verificationId: ids.verificationId ?? null,
    });
    try {
      const out = await handler({ jobKey, attempt, payload });
      await recordJobEnd(db, jobKey, {
        status: "SUCCEEDED",
        backtestRunId: out?.backtestRunId ?? null,
      });
      logger.info(
        { ...base, durationMs: Date.now() - started, outcome: "SUCCEEDED" },
        "job succeeded",
      );
    } catch (error) {
      const terminal = error instanceof TerminalJobError;
      const maxAttempts = job.opts.attempts ?? 1;
      const exhausted = terminal || attempt >= maxAttempts;
      const code = terminal ? error.code : "JOB_ERROR";
      const message = error instanceof Error ? error.message : "unknown error";
      await recordJobEnd(db, jobKey, {
        status: exhausted ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
        errorCode: code,
        errorMessage: message,
      });
      logger.error(
        {
          ...base,
          durationMs: Date.now() - started,
          outcome: exhausted ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
          errorCode: code,
          err: message,
        },
        "job failed",
      );
      if (terminal) throw new UnrecoverableError(`${code}: ${message}`);
      throw error;
    }
  };
}

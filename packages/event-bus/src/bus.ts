import { Queue, Worker, type ConnectionOptions, type Job, type WorkerOptions } from "bullmq";
import type { DomainEvent } from "@arf/contracts";
import { JobPayloadSchema, QUEUES, jobIdFor, routesFor, toJobPayload, type JobName, type JobPayload, type QueueName } from "./jobs";

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
} as const;

export class EventBus {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: ConnectionOptions) {}

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, q);
    }
    return q;
  }

  /** Publish a domain event to every routed queue with a deterministic job id. */
  async publish(event: DomainEvent): Promise<number> {
    const routes = routesFor(event);
    for (const route of routes) {
      await this.queue(route.queue).add(route.name, toJobPayload(event), { jobId: jobIdFor(event, route) });
    }
    return routes.length;
  }

  async counts(): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const name of Object.values(QUEUES)) {
      out[name] = await this.queue(name).getJobCounts("waiting", "active", "delayed", "failed", "completed");
    }
    return out;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

export type JobHandler = (payload: JobPayload, job: Job) => Promise<void>;

/** Start a worker that validates every payload before dispatching to a named handler. */
export function startWorker(
  queue: QueueName,
  connection: ConnectionOptions,
  handlers: Partial<Record<JobName, JobHandler>>,
  options: Partial<WorkerOptions> = {},
): Worker {
  return new Worker(
    queue,
    async (job) => {
      const handler = handlers[job.name as JobName];
      if (!handler) throw new Error(`no handler for job ${job.name} on ${queue}`);
      const payload = JobPayloadSchema.parse(job.data);
      await handler(payload, job);
    },
    { connection, concurrency: 4, ...options },
  );
}

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    username: u.username || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

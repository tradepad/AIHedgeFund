import type { AuthVerifier, Principal } from "@arf/auth";
import type { Database } from "@arf/db";
import type { EventBus } from "@arf/event-bus";
import type { Logger } from "@arf/observability";
import type { ObjectStore } from "@arf/storage";
import type { WorkflowEngine } from "@arf/workflow";
import type { Config } from "./config";

export interface AppContext {
  config: Config;
  db: Database;
  store: ObjectStore;
  auth: AuthVerifier;
  workflow: WorkflowEngine;
  logger: Logger;
  bus: EventBus | null;
}

/** Per-request facts every service needs for authorisation, audit and tracing. */
export interface RequestScope {
  principal: Principal;
  traceId: string;
  correlationId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    traceId: string;
    principal: Principal | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

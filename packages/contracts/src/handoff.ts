import { z } from "zod";
import { AgentRoleSchema } from "./enums";
import { SemverSchema } from "./common";

/** Common agent handoff envelope (spec §8). Version 1.0.0. */
export const HANDOFF_SCHEMA_VERSION = "1.0.0" as const;

export const HandoffSchema = z
  .object({
    schemaVersion: SemverSchema.refine((v) => v === HANDOFF_SCHEMA_VERSION),
    handoffId: z.uuid(),
    campaignId: z.uuid(),
    strategyId: z.uuid().nullable(),
    strategyVersionId: z.uuid().nullable(),
    fromAgent: z
      .object({
        role: AgentRoleSchema,
        agentId: z.string().min(1).max(200),
        promptVersion: z.string().regex(/^[0-9a-f]{64}$/, "sha256 of the prompt content"),
      })
      .strict(),
    toRole: AgentRoleSchema,
    taskId: z.uuid(),
    status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "FAILED"]),
    summary: z.string().min(1).max(2000),
    assumptions: z.array(z.string()),
    unknowns: z.array(z.string()),
    riskFlags: z.array(z.string()),
    artefactIds: z.array(z.uuid()),
    evidenceIds: z.array(z.uuid()),
    requestedAction: z.string().min(1).max(500),
    createdAt: z.iso.datetime({ offset: false }),
  })
  .strict();
export type Handoff = z.infer<typeof HandoffSchema>;

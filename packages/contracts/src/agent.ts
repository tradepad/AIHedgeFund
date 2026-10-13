import { z } from "zod";
import { AgentRoleSchema } from "./enums";
import { Sha256HexSchema, SemverSchema, UtcTimestampSchema, DecimalStringSchema } from "./common";
import { IdeaCardSchema } from "./idea-card";

export const PromptStatusSchema = z.enum(["DRAFT", "CHALLENGER", "APPROVED", "RETIRED"]);

export const PromptVersionSchema = z.object({
  id: z.uuid(),
  role: AgentRoleSchema,
  semver: SemverSchema,
  contentHash: Sha256HexSchema,
  status: PromptStatusSchema,
  benchmarkScore: DecimalStringSchema.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: UtcTimestampSchema.nullable(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

/** Agent task contract handed to a role runner. */
export const AgentTaskSchema = z.object({
  taskId: z.uuid(),
  campaignId: z.uuid(),
  role: AgentRoleSchema,
  objective: z.string().min(1).max(4000),
  constraints: z.array(z.string()),
  /** Untrusted retrieved content; always wrapped and labelled before reaching a model. */
  untrustedContext: z.array(z.object({ source: z.string(), content: z.string().max(20_000) })),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentRunStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "FAILED_VALIDATION", "FAILED_PROVIDER"]);

export const AgentRunSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  role: AgentRoleSchema,
  promptVersionId: z.uuid(),
  provider: z.string(),
  model: z.string(),
  status: AgentRunStatusSchema,
  attempts: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: DecimalStringSchema,
  outputArtefactId: z.uuid().nullable(),
  errorCode: z.string().nullable(),
  startedAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.nullable(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const GenerateIdeaRequestSchema = z
  .object({
    objective: z.string().trim().min(10).max(2000),
  })
  .strict();

export const IngestIdeaCardRequestSchema = z.object({ ideaCard: IdeaCardSchema }).strict();

export const IdeaCardRecordSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  taskId: z.uuid(),
  agentRunId: z.uuid().nullable(),
  artefactId: z.uuid(),
  ideaCard: IdeaCardSchema,
  createdAt: UtcTimestampSchema,
});
export type IdeaCardRecord = z.infer<typeof IdeaCardRecordSchema>;

import { z } from "zod";
import { CampaignStatusSchema, WorkflowStateSchema, AgentRoleSchema } from "./enums";
import { UtcTimestampSchema } from "./common";

export const CreateCampaignRequestSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    objective: z.string().trim().min(10).max(2000),
    assetClasses: z
      .array(z.enum(["crypto", "equity", "fx", "futures", "index", "commodity"]))
      .min(1),
    timeframes: z.array(z.string().regex(/^(\d+|\d*[DWM])$/)).min(1),
  })
  .strict();
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequestSchema>;

export const CampaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  objective: z.string(),
  assetClasses: z.array(z.string()),
  timeframes: z.array(z.string()),
  status: CampaignStatusSchema,
  createdBy: z.uuid(),
  createdAt: UtcTimestampSchema,
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const CampaignSummarySchema = CampaignSchema.extend({
  strategyCount: z.number().int(),
  versionCountsByState: z.record(z.string(), z.number().int()),
  taskCount: z.number().int(),
});
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

export const ResearchTaskSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  role: AgentRoleSchema,
  title: z.string(),
  state: WorkflowStateSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type ResearchTask = z.infer<typeof ResearchTaskSchema>;

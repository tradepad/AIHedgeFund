import { z } from "zod";

/**
 * UUIDv7 generator (RFC 9562). 48-bit Unix millisecond timestamp, version and
 * variant bits, and 74 random bits. Monotonic ordering within a millisecond is
 * not guaranteed; callers needing strict ordering must use a sequence column.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const ts = BigInt(nowMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}

const uuid = () => z.uuid();

export const OrganisationIdSchema = uuid().brand<"OrganisationId">();
export const UserIdSchema = uuid().brand<"UserId">();
export const CampaignIdSchema = uuid().brand<"CampaignId">();
export const ResearchTaskIdSchema = uuid().brand<"ResearchTaskId">();
export const StrategyIdSchema = uuid().brand<"StrategyId">();
export const StrategyVersionIdSchema = uuid().brand<"StrategyVersionId">();
export const StrategyDefinitionIdSchema = uuid().brand<"StrategyDefinitionId">();
export const PineRevisionIdSchema = uuid().brand<"PineRevisionId">();
export const ArtefactIdSchema = uuid().brand<"ArtefactId">();
export const VerificationIdSchema = uuid().brand<"VerificationId">();
export const ReportUploadIdSchema = uuid().brand<"ReportUploadId">();
export const BacktestRunIdSchema = uuid().brand<"BacktestRunId">();
export const TradeIdSchema = uuid().brand<"TradeId">();
export const MetricSnapshotIdSchema = uuid().brand<"MetricSnapshotId">();
export const ParityReportIdSchema = uuid().brand<"ParityReportId">();
export const DecisionIdSchema = uuid().brand<"DecisionId">();
export const AuditEventIdSchema = uuid().brand<"AuditEventId">();
export const EventIdSchema = uuid().brand<"EventId">();
export const AgentRunIdSchema = uuid().brand<"AgentRunId">();
export const HandoffIdSchema = uuid().brand<"HandoffId">();
export const IdeaCardIdSchema = uuid().brand<"IdeaCardId">();
export const PromptVersionIdSchema = uuid().brand<"PromptVersionId">();

export type OrganisationId = z.infer<typeof OrganisationIdSchema>;
export type UserId = z.infer<typeof UserIdSchema>;
export type CampaignId = z.infer<typeof CampaignIdSchema>;
export type ResearchTaskId = z.infer<typeof ResearchTaskIdSchema>;
export type StrategyId = z.infer<typeof StrategyIdSchema>;
export type StrategyVersionId = z.infer<typeof StrategyVersionIdSchema>;
export type StrategyDefinitionId = z.infer<typeof StrategyDefinitionIdSchema>;
export type PineRevisionId = z.infer<typeof PineRevisionIdSchema>;
export type ArtefactId = z.infer<typeof ArtefactIdSchema>;
export type VerificationId = z.infer<typeof VerificationIdSchema>;
export type ReportUploadId = z.infer<typeof ReportUploadIdSchema>;
export type BacktestRunId = z.infer<typeof BacktestRunIdSchema>;
export type TradeId = z.infer<typeof TradeIdSchema>;
export type MetricSnapshotId = z.infer<typeof MetricSnapshotIdSchema>;
export type ParityReportId = z.infer<typeof ParityReportIdSchema>;
export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type AuditEventId = z.infer<typeof AuditEventIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type AgentRunId = z.infer<typeof AgentRunIdSchema>;
export type HandoffId = z.infer<typeof HandoffIdSchema>;
export type IdeaCardId = z.infer<typeof IdeaCardIdSchema>;
export type PromptVersionId = z.infer<typeof PromptVersionIdSchema>;

/** Mint a new branded id. The brand is purely a compile-time marker. */
export function newId<T extends string>(): T {
  return uuidv7() as T;
}

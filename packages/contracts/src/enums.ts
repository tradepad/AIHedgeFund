import { z } from "zod";

/** Lifecycle states implemented in the first vertical slice (spec §5, build prompt). */
export const WorkflowStateSchema = z.enum([
  "CAMPAIGN_BACKLOG",
  "IDEA_RESEARCH",
  "HYPOTHESIS_DRAFT",
  "PINE_DEVELOPMENT",
  "TRADINGVIEW_VERIFICATION",
  "PAPER_APPROVAL_REVIEW",
  "PAPER_APPROVED",
  "REJECTED",
  "BLOCKED",
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

/** Human/service RBAC roles (spec §17.1). */
export const MemberRoleSchema = z.enum([
  "VIEWER",
  "RESEARCHER",
  "DEVELOPER",
  "VALIDATOR",
  "OPERATOR",
  "COMMITTEE_MEMBER",
  "ADMIN",
  "SERVICE_ACCOUNT",
]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

/** Agent lanes (spec §6). */
export const AgentRoleSchema = z.enum([
  "CHIEF_RESEARCH_ORCHESTRATOR",
  "IDEA_SCOUT",
  "INDICATOR_RESEARCHER",
  "STRATEGY_ARCHITECT",
  "PINE_ENGINEER",
  "BACKTEST_ENGINEER",
  "ROBUSTNESS_VALIDATOR",
  "FORWARD_TEST_OPERATOR",
  "STRATEGY_JUDGE",
  "DATA_INTEGRITY_ANALYST",
  "PORTFOLIO_RESEARCHER",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ActorTypeSchema = z.enum(["USER", "AGENT", "SERVICE"]);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const CampaignStatusSchema = z.enum(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const DecisionTypeSchema = z.enum(["REJECT", "REWORK_WITH_NEW_VERSION", "PAPER_APPROVED"]);
export type DecisionType = z.infer<typeof DecisionTypeSchema>;

export const ParityStatusSchema = z.enum(["PASS", "WARN", "FAIL", "INSUFFICIENT_DATA"]);
export type ParityStatus = z.infer<typeof ParityStatusSchema>;

export const JobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING_EXTERNAL",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "CANCELLED",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ReportTypeSchema = z.enum(["PERFORMANCE_SUMMARY", "LIST_OF_TRADES"]);
export type ReportType = z.infer<typeof ReportTypeSchema>;

export const ReportUploadStatusSchema = z.enum([
  "PENDING_UPLOAD",
  "UPLOADED",
  "PARSED",
  "PARSE_FAILED",
  "SUPERSEDED",
]);
export type ReportUploadStatus = z.infer<typeof ReportUploadStatusSchema>;

export const VerificationStatusSchema = z.enum([
  "AWAITING_UPLOADS",
  "PROCESSING",
  "PARSE_FAILED",
  "COMPLETED",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const RunnerTypeSchema = z.enum(["TRADINGVIEW", "LOCAL_RUNNER"]);
export type RunnerType = z.infer<typeof RunnerTypeSchema>;

export const TradeDirectionSchema = z.enum(["LONG", "SHORT"]);
export type TradeDirection = z.infer<typeof TradeDirectionSchema>;

export const MetricUnitSchema = z.enum([
  "CURRENCY",
  "PERCENT_POINTS",
  "RATIO",
  "COUNT",
  "SECONDS",
]);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

export const MetricSourceSchema = z.enum(["ARF_CALCULATED", "TRADINGVIEW_REPORTED"]);
export type MetricSource = z.infer<typeof MetricSourceSchema>;

export const MetricScopeTypeSchema = z.enum([
  "RUN",
  "SEGMENT",
  "STRATEGY_VERSION",
  "SYMBOL",
  "PARAMETER_SET",
  "FORWARD_DEPLOYMENT",
  "PORTFOLIO",
]);
export type MetricScopeType = z.infer<typeof MetricScopeTypeSchema>;

export const ArtefactKindSchema = z.enum([
  "SDL_DOCUMENT",
  "PINE_SOURCE",
  "PINE_MANIFEST",
  "TRADINGVIEW_RAW_REPORT",
  "TRADINGVIEW_PARSED_REPORT",
  "IDEA_CARD",
  "AGENT_RAW_OUTPUT",
  "DECISION_EVIDENCE_PACK",
]);
export type ArtefactKind = z.infer<typeof ArtefactKindSchema>;

export const ProtectionLevelSchema = z.enum(["STANDARD", "PROTECTED"]);
export type ProtectionLevel = z.infer<typeof ProtectionLevelSchema>;

export const LintStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);
export type LintStatus = z.infer<typeof LintStatusSchema>;

export const ChangeCategorySchema = z.enum([
  "PINE_SOURCE",
  "DEFINITION",
  "PARAMETERS",
  "SYMBOL",
  "TIMEFRAME",
  "SESSION",
  "COST_MODEL",
  "POSITION_SIZING",
  "LEVERAGE",
  "EXECUTION",
  "DATASET",
  "RUNNER",
  "SEGMENTS",
]);
export type ChangeCategory = z.infer<typeof ChangeCategorySchema>;

export const AggregateTypeSchema = z.enum([
  "ORGANISATION",
  "CAMPAIGN",
  "RESEARCH_TASK",
  "STRATEGY",
  "STRATEGY_VERSION",
  "STRATEGY_DEFINITION",
  "PINE_REVISION",
  "VERIFICATION",
  "REPORT_UPLOAD",
  "BACKTEST_RUN",
  "PARITY_REPORT",
  "DECISION",
  "ARTEFACT",
  "AGENT_RUN",
  "IDEA_CARD",
]);
export type AggregateType = z.infer<typeof AggregateTypeSchema>;

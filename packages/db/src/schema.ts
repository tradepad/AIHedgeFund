import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ActorTypeSchema,
  AgentRoleSchema,
  AggregateTypeSchema,
  ArtefactKindSchema,
  CampaignStatusSchema,
  ChangeCategorySchema,
  DecisionTypeSchema,
  JobStatusSchema,
  LintStatusSchema,
  MemberRoleSchema,
  MetricScopeTypeSchema,
  MetricSourceSchema,
  MetricUnitSchema,
  ParityStatusSchema,
  ProtectionLevelSchema,
  ReportTypeSchema,
  ReportUploadStatusSchema,
  RunnerTypeSchema,
  TradeDirectionSchema,
  VerificationStatusSchema,
  WorkflowStateSchema,
  AuditActionSchema,
  PromptStatusSchema,
  AgentRunStatusSchema,
} from "@arf/contracts";

/** Zod enums are never empty, so their options always form a non-empty tuple. */
function tuple<T extends string>(schema: { options: readonly T[] }): [T, ...T[]] {
  const [first, ...rest] = schema.options;
  if (first === undefined) throw new Error("enum must have at least one value");
  return [first, ...rest];
}

// ---------------------------------------------------------------------------
// Enums mirror the Zod enums in @arf/contracts so the database rejects values
// the application would reject.
// ---------------------------------------------------------------------------
export const workflowState = pgEnum("workflow_state", tuple(WorkflowStateSchema));
export const memberRole = pgEnum("member_role", tuple(MemberRoleSchema));
export const agentRole = pgEnum("agent_role", tuple(AgentRoleSchema));
export const actorType = pgEnum("actor_type", tuple(ActorTypeSchema));
export const campaignStatus = pgEnum("campaign_status", tuple(CampaignStatusSchema));
export const decisionType = pgEnum("decision_type", tuple(DecisionTypeSchema));
export const parityStatus = pgEnum("parity_status", tuple(ParityStatusSchema));
export const jobStatus = pgEnum("job_status", tuple(JobStatusSchema));
export const reportType = pgEnum("report_type", tuple(ReportTypeSchema));
export const reportUploadStatus = pgEnum("report_upload_status", tuple(ReportUploadStatusSchema));
export const verificationStatus = pgEnum("verification_status", tuple(VerificationStatusSchema));
export const runnerType = pgEnum("runner_type", tuple(RunnerTypeSchema));
export const tradeDirection = pgEnum("trade_direction", tuple(TradeDirectionSchema));
export const metricUnit = pgEnum("metric_unit", tuple(MetricUnitSchema));
export const metricSource = pgEnum("metric_source", tuple(MetricSourceSchema));
export const metricScopeType = pgEnum("metric_scope_type", tuple(MetricScopeTypeSchema));
export const artefactKind = pgEnum("artefact_kind", tuple(ArtefactKindSchema));
export const protectionLevel = pgEnum("protection_level", tuple(ProtectionLevelSchema));
export const lintStatus = pgEnum("lint_status", tuple(LintStatusSchema));
export const changeCategory = pgEnum("change_category", tuple(ChangeCategorySchema));
export const aggregateType = pgEnum("aggregate_type", tuple(AggregateTypeSchema));
export const auditAction = pgEnum("audit_action", tuple(AuditActionSchema));
export const promptStatus = pgEnum("prompt_status", tuple(PromptStatusSchema));
export const agentRunStatus = pgEnum("agent_run_status", tuple(AgentRunStatusSchema));
export const idempotencyState = pgEnum("idempotency_state", ["IN_PROGRESS", "COMPLETED"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
/** Money and prices: exact decimals, returned to TypeScript as strings. */
const money = (name: string) => numeric(name, { precision: 38, scale: 12 });
const orgId = () =>
  uuid("organisation_id")
    .notNull()
    .references(() => organisations.id);

// ---------------------------------------------------------------------------
// Identity and access
// ---------------------------------------------------------------------------
export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  externalAuthOrgId: text("external_auth_org_id").unique(),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  externalSubject: text("external_subject").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roles: memberRole("roles").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.organisationId, t.userId)],
);

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    assetClasses: text("asset_classes").array().notNull(),
    timeframes: text("timeframes").array().notNull(),
    status: campaignStatus("status").notNull().default("ACTIVE"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("campaigns_org_created_idx").on(t.organisationId, t.id)],
);

export const researchTasks = pgTable(
  "research_tasks",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    role: agentRole("role").notNull(),
    title: text("title").notNull(),
    state: workflowState("state").notNull(),
    input: jsonb("input").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("research_tasks_campaign_idx").on(t.organisationId, t.campaignId)],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey(),
    role: agentRole("role").notNull(),
    semver: text("semver").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    status: promptStatus("status").notNull(),
    benchmarkScore: numeric("benchmark_score", { precision: 10, scale: 4 }),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_versions_role_semver_uq").on(t.role, t.semver),
    uniqueIndex("prompt_versions_role_hash_uq").on(t.role, t.contentHash),
    check(
      "prompt_versions_approval_ck",
      sql`${t.status} <> 'APPROVED' OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`,
    ),
  ],
);

export const artefacts = pgTable(
  "artefacts",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    kind: artefactKind("kind").notNull(),
    objectKey: text("object_key").notNull().unique(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    protection: protectionLevel("protection").notNull().default("STANDARD"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("artefacts_org_kind_sha_uq").on(t.organisationId, t.kind, t.sha256)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => researchTasks.id),
    role: agentRole("role").notNull(),
    promptVersionId: uuid("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: agentRunStatus("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 18, scale: 6 }).notNull().default("0"),
    outputArtefactId: uuid("output_artefact_id").references(() => artefacts.id),
    rawOutputArtefactId: uuid("raw_output_artefact_id").references(() => artefacts.id),
    errorCode: text("error_code"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("agent_runs_task_idx").on(t.organisationId, t.taskId)],
);

export const ideaCards = pgTable(
  "idea_cards",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => researchTasks.id),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    artefactId: uuid("artefact_id")
      .notNull()
      .references(() => artefacts.id),
    title: text("title").notNull(),
    recommendation: text("recommendation").notNull(),
    content: jsonb("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("idea_cards_campaign_idx").on(t.organisationId, t.campaignId),
    uniqueIndex("idea_cards_task_uq").on(t.taskId),
  ],
);

export const handoffs = pgTable("handoffs", {
  id: uuid("id").primaryKey(),
  organisationId: orgId(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  taskId: uuid("task_id")
    .notNull()
    .references(() => researchTasks.id),
  agentRunId: uuid("agent_run_id")
    .notNull()
    .references(() => agentRuns.id)
    .unique(),
  fromRole: agentRole("from_role").notNull(),
  toRole: agentRole("to_role").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------
export const strategies = pgTable(
  "strategies",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    name: text("name").notNull(),
    family: text("family").notNull(),
    ideaCardId: uuid("idea_card_id").references(() => ideaCards.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("strategies_org_name_uq").on(t.organisationId, t.name)],
);

export const strategyVersions = pgTable(
  "strategy_versions",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id),
    parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => strategyVersions.id),
    versionNumber: integer("version_number").notNull(),
    state: workflowState("state").notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    definitionHash: text("definition_hash"),
    pineSourceHash: text("pine_source_hash"),
    manifestHash: text("manifest_hash"),
    changeReason: text("change_reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdByAgentRunId: uuid("created_by_agent_run_id").references(() => agentRuns.id),
    contaminatedDatasetIds: text("contaminated_dataset_ids").array().notNull().default(sql`'{}'::text[]`),
    lockedAt: ts("locked_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("strategy_versions_strategy_number_uq").on(t.strategyId, t.versionNumber),
    index("strategy_versions_org_state_idx").on(t.organisationId, t.state),
    check("strategy_versions_parent_ck", sql`${t.parentVersionId} IS NULL OR ${t.parentVersionId} <> ${t.id}`),
    check("strategy_versions_number_ck", sql`${t.versionNumber} > 0`),
  ],
);

export const strategyLineage = pgTable("strategy_lineage", {
  id: uuid("id").primaryKey(),
  organisationId: orgId(),
  parentVersionId: uuid("parent_version_id")
    .notNull()
    .references(() => strategyVersions.id),
  childVersionId: uuid("child_version_id")
    .notNull()
    .references(() => strategyVersions.id)
    .unique(),
  changeCategories: changeCategory("change_categories").array().notNull(),
  changedFields: text("changed_fields").array().notNull(),
  motivatingEvidenceIds: text("motivating_evidence_ids").array().notNull(),
  contaminatedData: text("contaminated_data").array().notNull(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const strategyDefinitions = pgTable("strategy_definitions", {
  id: uuid("id").primaryKey(),
  organisationId: orgId(),
  strategyVersionId: uuid("strategy_version_id")
    .notNull()
    .references(() => strategyVersions.id)
    .unique(),
  schemaVersion: text("schema_version").notNull(),
  content: jsonb("content").notNull(),
  contentHash: text("content_hash").notNull(),
  artefactId: uuid("artefact_id")
    .notNull()
    .references(() => artefacts.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const pineRevisions = pgTable("pine_revisions", {
  id: uuid("id").primaryKey(),
  organisationId: orgId(),
  strategyVersionId: uuid("strategy_version_id")
    .notNull()
    .references(() => strategyVersions.id)
    .unique(),
  sourceHash: text("source_hash").notNull(),
  manifest: jsonb("manifest").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  pineVersion: integer("pine_version").notNull(),
  lint: jsonb("lint").notNull(),
  lintStatus: lintStatus("lint_status").notNull(),
  sourceArtefactId: uuid("source_artefact_id")
    .notNull()
    .references(() => artefacts.id),
  manifestArtefactId: uuid("manifest_artefact_id")
    .notNull()
    .references(() => artefacts.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// TradingView verification and testing
// ---------------------------------------------------------------------------
export const tradingviewVerifications = pgTable(
  "tradingview_verifications",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    strategyVersionId: uuid("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id),
    pineRevisionId: uuid("pine_revision_id")
      .notNull()
      .references(() => pineRevisions.id),
    status: verificationStatus("status").notNull(),
    settings: jsonb("settings").notNull(),
    settingsHash: text("settings_hash").notNull(),
    requiredReportTypes: reportType("required_report_types").array().notNull(),
    numberLocaleHint: text("number_locale_hint"),
    dateOrderHint: text("date_order_hint"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("tv_verifications_version_idx").on(t.organisationId, t.strategyVersionId),
    index("tv_verifications_status_idx").on(t.organisationId, t.status),
  ],
);

export const reportUploads = pgTable(
  "report_uploads",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    verificationId: uuid("verification_id")
      .notNull()
      .references(() => tradingviewVerifications.id),
    reportType: reportType("report_type").notNull(),
    status: reportUploadStatus("status").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    declaredSha256: text("declared_sha256").notNull(),
    stagingObjectKey: text("staging_object_key").notNull().unique(),
    rawArtefactId: uuid("raw_artefact_id").references(() => artefacts.id),
    parsedArtefactId: uuid("parsed_artefact_id").references(() => artefacts.id),
    parserId: text("parser_id"),
    parserVersion: text("parser_version"),
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    attestedPineSourceHash: text("attested_pine_source_hash"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
    parsedAt: ts("parsed_at"),
  },
  (t) => [
    uniqueIndex("report_uploads_active_uq")
      .on(t.verificationId, t.reportType)
      .where(sql`${t.status} <> 'SUPERSEDED'`),
    index("report_uploads_status_idx").on(t.organisationId, t.status),
  ],
);

export const backtestRuns = pgTable(
  "backtest_runs",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    strategyVersionId: uuid("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id),
    verificationId: uuid("verification_id")
      .references(() => tradingviewVerifications.id)
      .unique(),
    runnerType: runnerType("runner_type").notNull(),
    runnerVersion: text("runner_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    settingsHash: text("settings_hash").notNull(),
    environmentHash: text("environment_hash").notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    initialCapital: money("initial_capital").notNull(),
    currency: text("currency").notNull(),
    parsers: jsonb("parsers").notNull(),
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
    status: jobStatus("status").notNull(),
    errorCode: text("error_code"),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("backtest_runs_version_idx").on(t.organisationId, t.strategyVersionId)],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    backtestRunId: uuid("backtest_run_id")
      .notNull()
      .references(() => backtestRuns.id),
    tradeNumber: integer("trade_number").notNull(),
    direction: tradeDirection("direction").notNull(),
    entryTime: ts("entry_time").notNull(),
    entryPrice: money("entry_price").notNull(),
    entrySignal: text("entry_signal"),
    exitTime: ts("exit_time").notNull(),
    exitPrice: money("exit_price").notNull(),
    exitSignal: text("exit_signal"),
    quantity: money("quantity").notNull(),
    reportedNetPnl: money("reported_net_pnl"),
    calcGrossPnl: money("calc_gross_pnl").notNull(),
    calcCommission: money("calc_commission").notNull(),
    calcNetPnl: money("calc_net_pnl").notNull(),
    holdingSeconds: integer("holding_seconds").notNull(),
    rawRows: jsonb("raw_rows").notNull(),
  },
  (t) => [
    uniqueIndex("trades_run_number_uq").on(t.backtestRunId, t.tradeNumber),
    check("trades_exit_after_entry_ck", sql`${t.exitTime} >= ${t.entryTime}`),
  ],
);

export const equityPoints = pgTable(
  "equity_points",
  {
    backtestRunId: uuid("backtest_run_id")
      .notNull()
      .references(() => backtestRuns.id),
    seq: integer("seq").notNull(),
    organisationId: orgId(),
    time: ts("time").notNull(),
    equity: money("equity").notNull(),
    tradeNumber: integer("trade_number"),
    calculationVersion: text("calculation_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.backtestRunId, t.calculationVersion, t.seq] })],
);

export const drawdownPoints = pgTable(
  "drawdown_points",
  {
    backtestRunId: uuid("backtest_run_id")
      .notNull()
      .references(() => backtestRuns.id),
    seq: integer("seq").notNull(),
    organisationId: orgId(),
    time: ts("time").notNull(),
    peakEquity: money("peak_equity").notNull(),
    drawdown: money("drawdown").notNull(),
    drawdownPct: money("drawdown_pct").notNull(),
    calculationVersion: text("calculation_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.backtestRunId, t.calculationVersion, t.seq] })],
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    scopeType: metricScopeType("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    source: metricSource("source").notNull(),
    metricName: text("metric_name").notNull(),
    periodKey: text("period_key").notNull().default(""),
    status: text("status").notNull(),
    value: money("value"),
    undefinedReason: text("undefined_reason"),
    unit: metricUnit("unit").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("metric_snapshots_identity_uq").on(
      t.scopeType,
      t.scopeId,
      t.source,
      t.metricName,
      t.periodKey,
      t.calculationVersion,
    ),
    check(
      "metric_snapshots_value_ck",
      sql`(${t.status} = 'DEFINED' AND ${t.value} IS NOT NULL) OR (${t.status} = 'UNDEFINED' AND ${t.value} IS NULL AND ${t.undefinedReason} IS NOT NULL)`,
    ),
  ],
);

export const parityReports = pgTable(
  "parity_reports",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    verificationId: uuid("verification_id")
      .notNull()
      .references(() => tradingviewVerifications.id),
    backtestRunId: uuid("backtest_run_id")
      .notNull()
      .references(() => backtestRuns.id),
    policyVersion: text("policy_version").notNull(),
    status: parityStatus("status").notNull(),
    checks: jsonb("checks").notNull(),
    firstDivergence: jsonb("first_divergence"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parity_reports_verification_policy_uq").on(t.verificationId, t.policyVersion)],
);

// ---------------------------------------------------------------------------
// Decisions and governance
// ---------------------------------------------------------------------------
export const committeeDecisions = pgTable(
  "committee_decisions",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    strategyVersionId: uuid("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id)
      .unique(),
    decision: decisionType("decision").notNull(),
    reasonCodes: text("reason_codes").array().notNull(),
    summary: text("summary").notNull(),
    rejectionCase: text("rejection_case").notNull(),
    parityReportId: uuid("parity_report_id").references(() => parityReports.id),
    evidence: jsonb("evidence").notNull(),
    policyVersion: text("policy_version").notNull(),
    humanOverride: boolean("human_override").notNull(),
    overrideReason: text("override_reason"),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "committee_decisions_override_ck",
      sql`NOT ${t.humanOverride} OR ${t.overrideReason} IS NOT NULL`,
    ),
  ],
);

export const stateTransitions = pgTable(
  "state_transitions",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    aggregateType: aggregateType("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    fromState: workflowState("from_state").notNull(),
    toState: workflowState("to_state").notNull(),
    reasonCodes: text("reason_codes").array().notNull(),
    summary: text("summary").notNull(),
    evidenceIds: text("evidence_ids").array().notNull(),
    policyVersion: text("policy_version").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    humanOverride: boolean("human_override").notNull().default(false),
    overrideReason: text("override_reason"),
    transitionKey: text("transition_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("state_transitions_aggregate_idx").on(t.organisationId, t.aggregateId)],
);

/**
 * Append-only, hash-chained per organisation. UPDATE and DELETE are blocked by
 * a trigger (see the immutability migration).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    organisationId: orgId(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: auditAction("action").notNull(),
    aggregateType: aggregateType("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    priorState: jsonb("prior_state"),
    newState: jsonb("new_state"),
    reason: text("reason").notNull(),
    traceId: text("trace_id").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_aggregate_idx").on(t.organisationId, t.aggregateId, t.seq),
    index("audit_events_org_seq_idx").on(t.organisationId, t.seq),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull(),
    aggregateType: aggregateType("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    actor: jsonb("actor").notNull(),
    payload: jsonb("payload").notNull(),
    traceId: text("trace_id").notNull(),
    createdAt: createdAt(),
    dispatchedAt: ts("dispatched_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_events_pending_idx").on(t.createdAt).where(sql`${t.dispatchedAt} IS NULL`)],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey(),
    organisationId: orgId(),
    actorId: text("actor_id").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: idempotencyState("state").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [uniqueIndex("idempotency_records_identity_uq").on(t.organisationId, t.actorId, t.scope, t.key)],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey(),
    jobKey: text("job_key").notNull().unique(),
    queue: text("queue").notNull(),
    jobName: text("job_name").notNull(),
    organisationId: orgId(),
    status: jobStatus("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    correlationId: text("correlation_id").notNull(),
    verificationId: uuid("verification_id"),
    backtestRunId: uuid("backtest_run_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("job_runs_org_status_idx").on(t.organisationId, t.status),
    index("job_runs_verification_idx").on(t.verificationId),
  ],
);

// ---------------------------------------------------------------------------
// Read models (derived; rebuilt from canonical tables by workers)
// ---------------------------------------------------------------------------
export const strategyLibraryReadModel = pgTable(
  "strategy_library_rm",
  {
    strategyVersionId: uuid("strategy_version_id")
      .primaryKey()
      .references(() => strategyVersions.id),
    organisationId: orgId(),
    strategyId: uuid("strategy_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    strategyName: text("strategy_name").notNull(),
    family: text("family").notNull(),
    versionNumber: integer("version_number").notNull(),
    state: workflowState("state").notNull(),
    assetClass: text("asset_class"),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    parityStatus: parityStatus("parity_status"),
    closedTradeCount: integer("closed_trade_count"),
    netProfit: money("net_profit"),
    maxDrawdownPct: money("max_drawdown_pct"),
    profitFactor: money("profit_factor"),
    lastDecision: decisionType("last_decision"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("strategy_library_rm_org_updated_idx").on(t.organisationId, t.updatedAt, t.strategyVersionId),
  ],
);

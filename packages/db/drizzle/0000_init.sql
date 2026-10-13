CREATE TYPE "public"."actor_type" AS ENUM('USER', 'AGENT', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('CHIEF_RESEARCH_ORCHESTRATOR', 'IDEA_SCOUT', 'INDICATOR_RESEARCHER', 'STRATEGY_ARCHITECT', 'PINE_ENGINEER', 'BACKTEST_ENGINEER', 'ROBUSTNESS_VALIDATOR', 'FORWARD_TEST_OPERATOR', 'STRATEGY_JUDGE', 'DATA_INTEGRITY_ANALYST', 'PORTFOLIO_RESEARCHER');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED_VALIDATION', 'FAILED_PROVIDER');--> statement-breakpoint
CREATE TYPE "public"."aggregate_type" AS ENUM('ORGANISATION', 'CAMPAIGN', 'RESEARCH_TASK', 'STRATEGY', 'STRATEGY_VERSION', 'STRATEGY_DEFINITION', 'PINE_REVISION', 'VERIFICATION', 'REPORT_UPLOAD', 'BACKTEST_RUN', 'PARITY_REPORT', 'DECISION', 'ARTEFACT', 'AGENT_RUN', 'IDEA_CARD');--> statement-breakpoint
CREATE TYPE "public"."artefact_kind" AS ENUM('SDL_DOCUMENT', 'PINE_SOURCE', 'PINE_MANIFEST', 'TRADINGVIEW_RAW_REPORT', 'TRADINGVIEW_PARSED_REPORT', 'IDEA_CARD', 'AGENT_RAW_OUTPUT', 'DECISION_EVIDENCE_PACK');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CAMPAIGN_CREATED', 'RESEARCH_TASK_CREATED', 'IDEA_CARD_CREATED', 'AGENT_RUN_RECORDED', 'STRATEGY_CREATED', 'STRATEGY_VERSION_CREATED', 'STRATEGY_DEFINITION_STORED', 'PINE_REVISION_STORED', 'STATE_TRANSITIONED', 'VERIFICATION_CREATED', 'REPORT_UPLOAD_REQUESTED', 'REPORT_UPLOAD_COMPLETED', 'REPORT_PARSED', 'REPORT_PARSE_FAILED', 'BACKTEST_RUN_RECORDED', 'PARITY_REPORT_CREATED', 'DECISION_RECORDED', 'HUMAN_OVERRIDE', 'PROTECTED_ARTEFACT_READ');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."change_category" AS ENUM('PINE_SOURCE', 'DEFINITION', 'PARAMETERS', 'SYMBOL', 'TIMEFRAME', 'SESSION', 'COST_MODEL', 'POSITION_SIZING', 'LEVERAGE', 'EXECUTION', 'DATASET', 'RUNNER', 'SEGMENTS');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('REJECT', 'REWORK_WITH_NEW_VERSION', 'PAPER_APPROVED');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'WAITING_EXTERNAL', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."lint_status" AS ENUM('PASS', 'WARN', 'FAIL');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('VIEWER', 'RESEARCHER', 'DEVELOPER', 'VALIDATOR', 'OPERATOR', 'COMMITTEE_MEMBER', 'ADMIN', 'SERVICE_ACCOUNT');--> statement-breakpoint
CREATE TYPE "public"."metric_scope_type" AS ENUM('RUN', 'SEGMENT', 'STRATEGY_VERSION', 'SYMBOL', 'PARAMETER_SET', 'FORWARD_DEPLOYMENT', 'PORTFOLIO');--> statement-breakpoint
CREATE TYPE "public"."metric_source" AS ENUM('ARF_CALCULATED', 'TRADINGVIEW_REPORTED');--> statement-breakpoint
CREATE TYPE "public"."metric_unit" AS ENUM('CURRENCY', 'PERCENT_POINTS', 'RATIO', 'COUNT', 'SECONDS');--> statement-breakpoint
CREATE TYPE "public"."parity_status" AS ENUM('PASS', 'WARN', 'FAIL', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "public"."prompt_status" AS ENUM('DRAFT', 'CHALLENGER', 'APPROVED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."protection_level" AS ENUM('STANDARD', 'PROTECTED');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('PERFORMANCE_SUMMARY', 'LIST_OF_TRADES');--> statement-breakpoint
CREATE TYPE "public"."report_upload_status" AS ENUM('PENDING_UPLOAD', 'UPLOADED', 'PARSED', 'PARSE_FAILED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."runner_type" AS ENUM('TRADINGVIEW', 'LOCAL_RUNNER');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('AWAITING_UPLOADS', 'PROCESSING', 'PARSE_FAILED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."workflow_state" AS ENUM('CAMPAIGN_BACKLOG', 'IDEA_RESEARCH', 'HYPOTHESIS_DRAFT', 'PINE_DEVELOPMENT', 'TRADINGVIEW_VERIFICATION', 'PAPER_APPROVAL_REVIEW', 'PAPER_APPROVED', 'REJECTED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"role" "agent_role" NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "agent_run_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"output_artefact_id" uuid,
	"raw_output_artefact_id" uuid,
	"error_code" text,
	"idempotency_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "artefacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" "artefact_kind" NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"protection" "protection_level" DEFAULT 'STANDARD' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artefacts_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"aggregate_type" "aggregate_type" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"prior_state" jsonb,
	"new_state" jsonb,
	"reason" text NOT NULL,
	"trace_id" text NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"verification_id" uuid,
	"runner_type" "runner_type" NOT NULL,
	"runner_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"settings_hash" text NOT NULL,
	"environment_hash" text NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"initial_capital" numeric(38, 12) NOT NULL,
	"currency" text NOT NULL,
	"parsers" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "job_status" NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "backtest_runs_verification_id_unique" UNIQUE("verification_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"asset_classes" text[] NOT NULL,
	"timeframes" text[] NOT NULL,
	"status" "campaign_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"decision" "decision_type" NOT NULL,
	"reason_codes" text[] NOT NULL,
	"summary" text NOT NULL,
	"rejection_case" text NOT NULL,
	"parity_report_id" uuid,
	"evidence" jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"human_override" boolean NOT NULL,
	"override_reason" text,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "committee_decisions_strategy_version_id_unique" UNIQUE("strategy_version_id"),
	CONSTRAINT "committee_decisions_override_ck" CHECK (NOT "committee_decisions"."human_override" OR "committee_decisions"."override_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "drawdown_points" (
	"backtest_run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"organisation_id" uuid NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"peak_equity" numeric(38, 12) NOT NULL,
	"drawdown" numeric(38, 12) NOT NULL,
	"drawdown_pct" numeric(38, 12) NOT NULL,
	"calculation_version" text NOT NULL,
	CONSTRAINT "drawdown_points_backtest_run_id_calculation_version_seq_pk" PRIMARY KEY("backtest_run_id","calculation_version","seq")
);
--> statement-breakpoint
CREATE TABLE "equity_points" (
	"backtest_run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"organisation_id" uuid NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"equity" numeric(38, 12) NOT NULL,
	"trade_number" integer,
	"calculation_version" text NOT NULL,
	CONSTRAINT "equity_points_backtest_run_id_calculation_version_seq_pk" PRIMARY KEY("backtest_run_id","calculation_version","seq")
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"from_role" "agent_role" NOT NULL,
	"to_role" "agent_role" NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoffs_agent_run_id_unique" UNIQUE("agent_run_id")
);
--> statement-breakpoint
CREATE TABLE "idea_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"artefact_id" uuid NOT NULL,
	"title" text NOT NULL,
	"recommendation" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" "idempotency_state" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_key" text NOT NULL,
	"queue" text NOT NULL,
	"job_name" text NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "job_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correlation_id" text NOT NULL,
	"verification_id" uuid,
	"backtest_run_id" uuid,
	"last_error_code" text,
	"last_error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_runs_job_key_unique" UNIQUE("job_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"roles" "member_role"[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"scope_type" "metric_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"source" "metric_source" NOT NULL,
	"metric_name" text NOT NULL,
	"period_key" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"value" numeric(38, 12),
	"undefined_reason" text,
	"unit" "metric_unit" NOT NULL,
	"calculation_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_value_ck" CHECK (("metric_snapshots"."status" = 'DEFINED' AND "metric_snapshots"."value" IS NOT NULL) OR ("metric_snapshots"."status" = 'UNDEFINED' AND "metric_snapshots"."value" IS NULL AND "metric_snapshots"."undefined_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"external_auth_org_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organisations_external_auth_org_id_unique" UNIQUE("external_auth_org_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"aggregate_type" "aggregate_type" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "parity_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"verification_id" uuid NOT NULL,
	"backtest_run_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"status" "parity_status" NOT NULL,
	"checks" jsonb NOT NULL,
	"first_divergence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pine_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"pine_version" integer NOT NULL,
	"lint" jsonb NOT NULL,
	"lint_status" "lint_status" NOT NULL,
	"source_artefact_id" uuid NOT NULL,
	"manifest_artefact_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pine_revisions_strategy_version_id_unique" UNIQUE("strategy_version_id")
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "agent_role" NOT NULL,
	"semver" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "prompt_status" NOT NULL,
	"benchmark_score" numeric(10, 4),
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_approval_ck" CHECK ("prompt_versions"."status" <> 'APPROVED' OR ("prompt_versions"."approved_by" IS NOT NULL AND "prompt_versions"."approved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "report_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"verification_id" uuid NOT NULL,
	"report_type" "report_type" NOT NULL,
	"status" "report_upload_status" NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"declared_sha256" text NOT NULL,
	"staging_object_key" text NOT NULL,
	"raw_artefact_id" uuid,
	"parsed_artefact_id" uuid,
	"parser_id" text,
	"parser_version" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_detail" text,
	"attested_pine_source_hash" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"parsed_at" timestamp with time zone,
	CONSTRAINT "report_uploads_staging_object_key_unique" UNIQUE("staging_object_key")
);
--> statement-breakpoint
CREATE TABLE "research_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"role" "agent_role" NOT NULL,
	"title" text NOT NULL,
	"state" "workflow_state" NOT NULL,
	"input" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"aggregate_type" "aggregate_type" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"from_state" "workflow_state" NOT NULL,
	"to_state" "workflow_state" NOT NULL,
	"reason_codes" text[] NOT NULL,
	"summary" text NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"policy_version" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"human_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"transition_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_transitions_transition_key_unique" UNIQUE("transition_key")
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"idea_card_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"artefact_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_definitions_strategy_version_id_unique" UNIQUE("strategy_version_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_library_rm" (
	"strategy_version_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"strategy_name" text NOT NULL,
	"family" text NOT NULL,
	"version_number" integer NOT NULL,
	"state" "workflow_state" NOT NULL,
	"asset_class" text,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"parity_status" "parity_status",
	"closed_trade_count" integer,
	"net_profit" numeric(38, 12),
	"max_drawdown_pct" numeric(38, 12),
	"profit_factor" numeric(38, 12),
	"last_decision" "decision_type",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_lineage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"parent_version_id" uuid NOT NULL,
	"child_version_id" uuid NOT NULL,
	"change_categories" "change_category"[] NOT NULL,
	"changed_fields" text[] NOT NULL,
	"motivating_evidence_ids" text[] NOT NULL,
	"contaminated_data" text[] NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_lineage_child_version_id_unique" UNIQUE("child_version_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"parent_version_id" uuid,
	"version_number" integer NOT NULL,
	"state" "workflow_state" NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"definition_hash" text,
	"pine_source_hash" text,
	"manifest_hash" text,
	"change_reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_by_agent_run_id" uuid,
	"contaminated_dataset_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_versions_parent_ck" CHECK ("strategy_versions"."parent_version_id" IS NULL OR "strategy_versions"."parent_version_id" <> "strategy_versions"."id"),
	CONSTRAINT "strategy_versions_number_ck" CHECK ("strategy_versions"."version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"backtest_run_id" uuid NOT NULL,
	"trade_number" integer NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"entry_price" numeric(38, 12) NOT NULL,
	"entry_signal" text,
	"exit_time" timestamp with time zone NOT NULL,
	"exit_price" numeric(38, 12) NOT NULL,
	"exit_signal" text,
	"quantity" numeric(38, 12) NOT NULL,
	"reported_net_pnl" numeric(38, 12),
	"calc_gross_pnl" numeric(38, 12) NOT NULL,
	"calc_commission" numeric(38, 12) NOT NULL,
	"calc_net_pnl" numeric(38, 12) NOT NULL,
	"holding_seconds" integer NOT NULL,
	"raw_rows" jsonb NOT NULL,
	CONSTRAINT "trades_exit_after_entry_ck" CHECK ("trades"."exit_time" >= "trades"."entry_time")
);
--> statement-breakpoint
CREATE TABLE "tradingview_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"pine_revision_id" uuid NOT NULL,
	"status" "verification_status" NOT NULL,
	"settings" jsonb NOT NULL,
	"settings_hash" text NOT NULL,
	"required_report_types" "report_type"[] NOT NULL,
	"number_locale_hint" text,
	"date_order_hint" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_subject" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_subject_unique" UNIQUE("external_subject")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_output_artefact_id_artefacts_id_fk" FOREIGN KEY ("output_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_raw_output_artefact_id_artefacts_id_fk" FOREIGN KEY ("raw_output_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artefacts" ADD CONSTRAINT "artefacts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_verification_id_tradingview_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."tradingview_verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_parity_report_id_parity_reports_id_fk" FOREIGN KEY ("parity_report_id") REFERENCES "public"."parity_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_decisions" ADD CONSTRAINT "committee_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawdown_points" ADD CONSTRAINT "drawdown_points_backtest_run_id_backtest_runs_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawdown_points" ADD CONSTRAINT "drawdown_points_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_points" ADD CONSTRAINT "equity_points_backtest_run_id_backtest_runs_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_points" ADD CONSTRAINT "equity_points_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_cards" ADD CONSTRAINT "idea_cards_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_cards" ADD CONSTRAINT "idea_cards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_cards" ADD CONSTRAINT "idea_cards_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_cards" ADD CONSTRAINT "idea_cards_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_cards" ADD CONSTRAINT "idea_cards_artefact_id_artefacts_id_fk" FOREIGN KEY ("artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parity_reports" ADD CONSTRAINT "parity_reports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parity_reports" ADD CONSTRAINT "parity_reports_verification_id_tradingview_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."tradingview_verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parity_reports" ADD CONSTRAINT "parity_reports_backtest_run_id_backtest_runs_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pine_revisions" ADD CONSTRAINT "pine_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pine_revisions" ADD CONSTRAINT "pine_revisions_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pine_revisions" ADD CONSTRAINT "pine_revisions_source_artefact_id_artefacts_id_fk" FOREIGN KEY ("source_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pine_revisions" ADD CONSTRAINT "pine_revisions_manifest_artefact_id_artefacts_id_fk" FOREIGN KEY ("manifest_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pine_revisions" ADD CONSTRAINT "pine_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_uploads" ADD CONSTRAINT "report_uploads_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_uploads" ADD CONSTRAINT "report_uploads_verification_id_tradingview_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."tradingview_verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_uploads" ADD CONSTRAINT "report_uploads_raw_artefact_id_artefacts_id_fk" FOREIGN KEY ("raw_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_uploads" ADD CONSTRAINT "report_uploads_parsed_artefact_id_artefacts_id_fk" FOREIGN KEY ("parsed_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_uploads" ADD CONSTRAINT "report_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_idea_card_id_idea_cards_id_fk" FOREIGN KEY ("idea_card_id") REFERENCES "public"."idea_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_definitions" ADD CONSTRAINT "strategy_definitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_definitions" ADD CONSTRAINT "strategy_definitions_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_definitions" ADD CONSTRAINT "strategy_definitions_artefact_id_artefacts_id_fk" FOREIGN KEY ("artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_definitions" ADD CONSTRAINT "strategy_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_library_rm" ADD CONSTRAINT "strategy_library_rm_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_library_rm" ADD CONSTRAINT "strategy_library_rm_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_lineage" ADD CONSTRAINT "strategy_lineage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_lineage" ADD CONSTRAINT "strategy_lineage_parent_version_id_strategy_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_lineage" ADD CONSTRAINT "strategy_lineage_child_version_id_strategy_versions_id_fk" FOREIGN KEY ("child_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_parent_version_id_strategy_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_created_by_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("created_by_agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_backtest_run_id_backtest_runs_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradingview_verifications" ADD CONSTRAINT "tradingview_verifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradingview_verifications" ADD CONSTRAINT "tradingview_verifications_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradingview_verifications" ADD CONSTRAINT "tradingview_verifications_pine_revision_id_pine_revisions_id_fk" FOREIGN KEY ("pine_revision_id") REFERENCES "public"."pine_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradingview_verifications" ADD CONSTRAINT "tradingview_verifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_task_idx" ON "agent_runs" USING btree ("organisation_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artefacts_org_kind_sha_uq" ON "artefacts" USING btree ("organisation_id","kind","sha256");--> statement-breakpoint
CREATE INDEX "audit_events_aggregate_idx" ON "audit_events" USING btree ("organisation_id","aggregate_id","seq");--> statement-breakpoint
CREATE INDEX "audit_events_org_seq_idx" ON "audit_events" USING btree ("organisation_id","seq");--> statement-breakpoint
CREATE INDEX "backtest_runs_version_idx" ON "backtest_runs" USING btree ("organisation_id","strategy_version_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_created_idx" ON "campaigns" USING btree ("organisation_id","id");--> statement-breakpoint
CREATE INDEX "idea_cards_campaign_idx" ON "idea_cards" USING btree ("organisation_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_cards_task_uq" ON "idea_cards" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_identity_uq" ON "idempotency_records" USING btree ("organisation_id","actor_id","scope","key");--> statement-breakpoint
CREATE INDEX "job_runs_org_status_idx" ON "job_runs" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "job_runs_verification_idx" ON "job_runs" USING btree ("verification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_identity_uq" ON "metric_snapshots" USING btree ("scope_type","scope_id","source","metric_name","period_key","calculation_version");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "parity_reports_verification_policy_uq" ON "parity_reports" USING btree ("verification_id","policy_version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_role_semver_uq" ON "prompt_versions" USING btree ("role","semver");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_role_hash_uq" ON "prompt_versions" USING btree ("role","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "report_uploads_active_uq" ON "report_uploads" USING btree ("verification_id","report_type") WHERE "report_uploads"."status" <> 'SUPERSEDED';--> statement-breakpoint
CREATE INDEX "report_uploads_status_idx" ON "report_uploads" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "research_tasks_campaign_idx" ON "research_tasks" USING btree ("organisation_id","campaign_id");--> statement-breakpoint
CREATE INDEX "state_transitions_aggregate_idx" ON "state_transitions" USING btree ("organisation_id","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_org_name_uq" ON "strategies" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "strategy_library_rm_org_updated_idx" ON "strategy_library_rm" USING btree ("organisation_id","updated_at","strategy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_strategy_number_uq" ON "strategy_versions" USING btree ("strategy_id","version_number");--> statement-breakpoint
CREATE INDEX "strategy_versions_org_state_idx" ON "strategy_versions" USING btree ("organisation_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_run_number_uq" ON "trades" USING btree ("backtest_run_id","trade_number");--> statement-breakpoint
CREATE INDEX "tv_verifications_version_idx" ON "tradingview_verifications" USING btree ("organisation_id","strategy_version_id");--> statement-breakpoint
CREATE INDEX "tv_verifications_status_idx" ON "tradingview_verifications" USING btree ("organisation_id","status");
CREATE TYPE "public"."external_engine" AS ENUM('TRADER_DEV', 'OFFLINE_SCRIPT');--> statement-breakpoint
CREATE TYPE "public"."external_provenance" AS ENUM('OUR_RUN', 'AUTHOR_REPORTED');--> statement-breakpoint
CREATE TYPE "public"."external_run_status" AS ENUM('COMPLETED', 'NOT_RUN');--> statement-breakpoint
CREATE TYPE "public"."external_segment" AS ENUM('IN_SAMPLE', 'HOLDOUT', 'OUT_OF_SAMPLE', 'FULL_HISTORY', 'SUB_PERIOD', 'AUTHOR_WINDOW');--> statement-breakpoint
CREATE TYPE "public"."external_source_language" AS ENUM('PINE', 'PYTHON');--> statement-breakpoint
CREATE TYPE "public"."external_verdict" AS ENUM('PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_EVALUATED');--> statement-breakpoint
ALTER TYPE "public"."artefact_kind" ADD VALUE 'EXTERNAL_IMPORT_BUNDLE';--> statement-breakpoint
ALTER TYPE "public"."artefact_kind" ADD VALUE 'EXTERNAL_STRATEGY_SOURCE';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'EXTERNAL_EVIDENCE_IMPORTED';--> statement-breakpoint
CREATE TABLE "external_backtest_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"strategy_import_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"result_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"engine" "external_engine" NOT NULL,
	"engine_version" text,
	"provenance" "external_provenance" NOT NULL,
	"segment" "external_segment" NOT NULL,
	"run_status" "external_run_status" NOT NULL,
	"window_from" date,
	"window_to" date,
	"external_result_id" text,
	"closed_trade_count" integer,
	"profit_factor" numeric(38, 12),
	"max_drawdown_pct" numeric(38, 12),
	"net_profit_pct" numeric(38, 12),
	"net_profit" numeric(38, 12),
	"largest_win" numeric(38, 12),
	"currency" text,
	"extra_metrics" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"verdict" "external_verdict" NOT NULL,
	"verdict_reasons" text[] NOT NULL,
	"notes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_backtest_results_window_ck" CHECK ("external_backtest_results"."window_from" IS NULL OR "external_backtest_results"."window_to" IS NULL OR "external_backtest_results"."window_from" <= "external_backtest_results"."window_to"),
	CONSTRAINT "external_backtest_results_not_run_ck" CHECK ("external_backtest_results"."run_status" <> 'NOT_RUN' OR ("external_backtest_results"."closed_trade_count" IS NULL AND "external_backtest_results"."profit_factor" IS NULL AND "external_backtest_results"."net_profit" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "external_import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"schema_version" text NOT NULL,
	"bundle_artefact_id" uuid NOT NULL,
	"bundle_sha256" text NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_strategy_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"import_key" text NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"external_strategy_id" text,
	"source_language" "external_source_language",
	"source_sha256" text,
	"source_artefact_id" uuid,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_strategy_imports_strategy_version_id_unique" UNIQUE("strategy_version_id"),
	CONSTRAINT "external_strategy_imports_source_ck" CHECK (("external_strategy_imports"."source_artefact_id" IS NULL) = ("external_strategy_imports"."source_sha256" IS NULL) AND ("external_strategy_imports"."source_sha256" IS NULL) = ("external_strategy_imports"."source_language" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "external_backtest_results" ADD CONSTRAINT "external_backtest_results_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_backtest_results" ADD CONSTRAINT "external_backtest_results_strategy_import_id_external_strategy_imports_id_fk" FOREIGN KEY ("strategy_import_id") REFERENCES "public"."external_strategy_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_backtest_results" ADD CONSTRAINT "external_backtest_results_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_import_batches" ADD CONSTRAINT "external_import_batches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_import_batches" ADD CONSTRAINT "external_import_batches_bundle_artefact_id_artefacts_id_fk" FOREIGN KEY ("bundle_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_import_batches" ADD CONSTRAINT "external_import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_strategy_imports" ADD CONSTRAINT "external_strategy_imports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_strategy_imports" ADD CONSTRAINT "external_strategy_imports_batch_id_external_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."external_import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_strategy_imports" ADD CONSTRAINT "external_strategy_imports_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_strategy_imports" ADD CONSTRAINT "external_strategy_imports_source_artefact_id_artefacts_id_fk" FOREIGN KEY ("source_artefact_id") REFERENCES "public"."artefacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_strategy_imports" ADD CONSTRAINT "external_strategy_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_backtest_results_org_key_uq" ON "external_backtest_results" USING btree ("organisation_id","result_key");--> statement-breakpoint
CREATE INDEX "external_backtest_results_version_idx" ON "external_backtest_results" USING btree ("organisation_id","strategy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_import_batches_org_sha_uq" ON "external_import_batches" USING btree ("organisation_id","bundle_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "external_strategy_imports_org_key_uq" ON "external_strategy_imports" USING btree ("organisation_id","import_key");--> statement-breakpoint
-- External evidence is append-only, like every other research artefact (CLAUDE.md §3.1).
CREATE TRIGGER external_import_batches_immutable BEFORE UPDATE OR DELETE ON external_import_batches
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER external_strategy_imports_immutable BEFORE UPDATE OR DELETE ON external_strategy_imports
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER external_backtest_results_immutable BEFORE UPDATE OR DELETE ON external_backtest_results
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();

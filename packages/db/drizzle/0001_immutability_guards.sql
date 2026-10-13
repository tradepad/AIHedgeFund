-- Immutability and append-only guards (CLAUDE.md §3.1, §9.4).
-- These triggers make the database itself reject mutation of research
-- artefacts, so a bug or ad hoc script cannot silently rewrite evidence.

CREATE OR REPLACE FUNCTION arf_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ARF_IMMUTABLE: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER artefacts_immutable BEFORE UPDATE OR DELETE ON artefacts
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER strategy_definitions_immutable BEFORE UPDATE OR DELETE ON strategy_definitions
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER pine_revisions_immutable BEFORE UPDATE OR DELETE ON pine_revisions
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER strategy_lineage_immutable BEFORE UPDATE OR DELETE ON strategy_lineage
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER state_transitions_immutable BEFORE UPDATE OR DELETE ON state_transitions
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER committee_decisions_immutable BEFORE UPDATE OR DELETE ON committee_decisions
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER parity_reports_immutable BEFORE UPDATE OR DELETE ON parity_reports
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trades_immutable BEFORE UPDATE OR DELETE ON trades
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER equity_points_immutable BEFORE UPDATE OR DELETE ON equity_points
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER drawdown_points_immutable BEFORE UPDATE OR DELETE ON drawdown_points
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER metric_snapshots_immutable BEFORE UPDATE OR DELETE ON metric_snapshots
  FOR EACH ROW EXECUTE FUNCTION arf_reject_mutation();
--> statement-breakpoint

-- Strategy versions: identity is fixed at creation. Artefact hashes may be
-- attached once (NULL -> value) and never changed. Lifecycle state may change,
-- but only through the workflow engine, which records a state_transitions row
-- in the same transaction. Once locked (tested) the lock cannot be removed.
CREATE OR REPLACE FUNCTION arf_guard_strategy_version() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ARF_IMMUTABLE: strategy versions cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.organisation_id <> OLD.organisation_id
     OR NEW.strategy_id <> OLD.strategy_id
     OR NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id
     OR NEW.version_number <> OLD.version_number
     OR NEW.symbol <> OLD.symbol
     OR NEW.timeframe <> OLD.timeframe
     OR NEW.change_reason <> OLD.change_reason
     OR NEW.created_by <> OLD.created_by
     OR NEW.created_by_agent_run_id IS DISTINCT FROM OLD.created_by_agent_run_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.contaminated_dataset_ids <> OLD.contaminated_dataset_ids THEN
    RAISE EXCEPTION 'ARF_IMMUTABLE: strategy version identity fields cannot change; create a child version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.definition_hash IS NOT NULL AND NEW.definition_hash IS DISTINCT FROM OLD.definition_hash)
     OR (OLD.pine_source_hash IS NOT NULL AND NEW.pine_source_hash IS DISTINCT FROM OLD.pine_source_hash)
     OR (OLD.manifest_hash IS NOT NULL AND NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash) THEN
    RAISE EXCEPTION 'ARF_IMMUTABLE: strategy version artefact hashes are write-once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.locked_at IS NOT NULL AND (
       NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
       OR NEW.pine_source_hash IS DISTINCT FROM OLD.pine_source_hash
       OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash) THEN
    RAISE EXCEPTION 'ARF_IMMUTABLE: strategy version is locked for testing'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT EXISTS (
       SELECT 1 FROM state_transitions st
        WHERE st.aggregate_id = NEW.id
          AND st.from_state = OLD.state
          AND st.to_state = NEW.state
          AND st.created_at >= transaction_timestamp()) THEN
    RAISE EXCEPTION 'ARF_WORKFLOW: state change % -> % has no transition record in this transaction', OLD.state, NEW.state
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER strategy_versions_guard BEFORE UPDATE OR DELETE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION arf_guard_strategy_version();

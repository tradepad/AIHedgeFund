# Database overview

PostgreSQL 16 is authoritative for identity, workflow state, the strategy
registry, evidence metadata, decisions, audit, outbox and job references.
Large immutable files live in the object store and are referenced from
`artefacts` by key and SHA-256.

Migrations live in `packages/db/drizzle`:

| Migration | Contents |
|---|---|
| `0000_init.sql` | All tables, enums, foreign keys, unique constraints and indexes |
| `0001_immutability_guards.sql` | Triggers that make research artefacts immutable at the database level |

Apply with `pnpm db:migrate`; seed development organisations, users and the
approved IDEA_SCOUT prompt with `pnpm db:seed`.

## Tables by area

| Area | Tables | Notes |
|---|---|---|
| Identity | `organisations`, `users`, `memberships` | Roles per membership; every aggregate carries `organisation_id` |
| Research | `campaigns`, `research_tasks`, `prompt_versions`, `agent_runs`, `idea_cards`, `handoffs` | Prompt versions are content-hashed; only `APPROVED` prompts run |
| Registry | `strategies`, `strategy_versions`, `strategy_lineage`, `strategy_definitions`, `pine_revisions` | One definition and one Pine revision per version, write-once |
| Verification | `tradingview_verifications`, `report_uploads` | Settings snapshot and hash; superseded uploads are kept |
| Results | `backtest_runs`, `trades`, `equity_points`, `drawdown_points`, `metric_snapshots`, `parity_reports` | Calculated and TradingView-reported metrics are separate rows (`source`) |
| External evidence | `external_import_batches`, `external_strategy_imports`, `external_backtest_results` | Research done outside ARF-OS; never ARF metrics or workflow evidence (ADR 0005) |
| Governance | `state_transitions`, `committee_decisions`, `audit_events` | Decisions unique per version; audit is a per-organisation hash chain |
| Infrastructure | `artefacts`, `outbox_events`, `idempotency_records`, `job_runs` | |
| Read models | `strategy_library_rm` | Rebuilt by `read_model.refresh`; never a source of truth |

## Invariants enforced by the database

- **Append-only / immutable rows.** Updates and deletes raise `ARF_IMMUTABLE`
  on `audit_events`, `artefacts`, `strategy_definitions`, `pine_revisions`,
  `strategy_lineage`, `state_transitions`, `committee_decisions`,
  `parity_reports`, `trades`, `equity_points`, `drawdown_points`,
  `metric_snapshots` and the three `external_*` tables.
- **Strategy versions.** Identity fields (symbol, timeframe, parent, hashes
  once set) cannot change, deletes are refused, and `state` can only change
  inside a transaction that also records a `state_transitions` row
  (`ARF_WORKFLOW`).
- **Uniqueness.** One decision per version; one non-superseded upload per
  report type per verification; one parity report per verification and
  policy version; one outbox row per event id; one idempotency record per
  organisation, actor, scope and key; deterministic job keys in `job_runs`.
  (One active verification per version is enforced by the service under a
  row lock on the version.)
- **Audit chain.** Each `audit_events` row stores `prev_hash` and `hash`
  (SHA-256 over canonical JSON). Appends are serialised per organisation with
  an advisory lock. `GET /v1/audit/verify` recomputes the chain.

## Money, time and units

- Prices, quantities, P&L and metric values are `numeric` and travel as
  decimal strings; arithmetic uses `decimal.js`.
- Percentages are stored as percentage points (`5` means 5%) and metric rows
  carry an explicit `unit` (`CURRENCY`, `PERCENT_POINTS`, `RATIO`, `COUNT`,
  `SECONDS`).
- Timestamps are `timestamptz` in UTC; the chart timezone of a verification is
  stored separately as an IANA name.

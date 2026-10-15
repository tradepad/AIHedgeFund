# ADR 0005: Import research done outside ARF-OS as external evidence

## Status

Accepted.

## Context

Strategies were researched before ARF-OS could run them: a 10-strategy BTC 1h
pilot and a 32-strategy library re-test on trader-dev, and an offline
SMA 50/200 baseline script. Their ideas, settings, verdicts and some Pine
source belong in the registry so they are not lost or re-tested blindly.

Their numbers are not ARF evidence. They were not produced by an ARF runner,
were not TradingView-verified through a verification, have no trade ledger
ARF can recompute, and some are figures reported by a library author. Writing
them into `backtest_runs` or `metric_snapshots` would let them satisfy
`METRICS_CALCULATED` or appear in the Strategy Library as ARF-calculated
(CLAUDE.md §18.1, §26 "never merge local-runner and TradingView results
without a parity report").

## Decision

- A versioned contract, `ExternalImportBundleSchema` (1.0.0,
  `schemas/external-import-bundle.schema.json`), describes campaigns,
  strategies, ordered versions and their results.
- `pnpm import:external <bundle.json>` validates the bundle and imports it in
  one transaction as a named user (default `dev|researcher` in `arf-dev`,
  which needs `strategy:write`).
- Campaigns, strategies and versions are created through the registry
  services, with the same audit and outbox records as the UI. The first
  version of a strategy is a root; each later version is a child with declared
  change categories and fields, and the data its parent's results covered is
  recorded as contaminated for the child.
- Results go to `external_backtest_results`, labelled by engine, provenance
  (`OUR_RUN` or `AUTHOR_REPORTED`), segment and the external study's own
  verdict. Imported source goes to object storage as
  `EXTERNAL_STRATEGY_SOURCE`, not as a Pine revision. The raw bundle is stored
  as `EXTERNAL_IMPORT_BUNDLE`.
- Imported versions stay in `HYPOTHESIS_DRAFT`. Nothing in the import changes
  lifecycle state, records a decision, or counts as workflow evidence.
- The web app shows imported results on a separate "external" tab with an
  "External · not ARF-verified" label.

## Alternatives

- Store results as `backtest_runs` with a new runner type: rejected; it would
  satisfy workflow evidence and mix unverified numbers into ARF metrics.
- Record committee REJECT decisions for failed strategies during import:
  rejected; a decision needs an independent committee member and ARF
  evidence. People can still reject them in the UI.
- Attach imported Pine as a Pine revision: rejected; that requires an SDL and
  manifest the source was never written against, and most imported source
  does not pass ARF lint.

## Consequences

- Imported strategies appear in campaigns and the Strategy Library with no
  ARF metrics until they are re-run through a TradingView verification.
- A re-run of the same bundle is a no-op. Reusing an import key with different
  content fails with `IMPORT_KEY_REUSED`; new research needs new keys.

## Security implications

- Every read goes through the organisation-scoped version lookup; another
  organisation gets 404.
- The CLI runs as a real membership and checks `strategy:write`; it cannot
  write outside that organisation.
- Imported rows are append-only (`ARF_IMMUTABLE` triggers).

## Migration/rollback

Migration `0002_external_evidence` adds enums and three tables and appends
enum values to `artefact_kind` and `audit_action`. It is additive. Rolling
back the code leaves the tables unused; dropping them is a separate, destructive
migration that would need its own ADR.

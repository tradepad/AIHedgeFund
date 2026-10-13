# ADR 0004: Human-assisted TradingView verification with CSV ingestion

## Status

Accepted (vertical slice).

## Context

TradingView is the acceptance environment for Pine behaviour, but it has no
supported API for running strategies or exporting Strategy Tester reports.
CLAUDE.md forbids browser automation as a core dependency without an ADR that
covers terms, reliability and security, and forbids sending TradingView
exports to a model.

## Decision

- Verification is human-assisted. ARF creates a verification with an immutable
  settings snapshot derived from the Pine manifest (symbol, timeframe, window,
  capital, costs, sizing, margin, execution flags) and its hash.
- The operator runs the exact Pine source in TradingView and uploads the
  Performance Summary and List of Trades CSV exports through presigned uploads.
- On completion the operator attests the Pine source hash they ran and that the
  chart settings matched; the server rejects an attestation that does not match
  the verification's Pine source hash.
- Exports are parsed deterministically by versioned adapters (see
  `docs/tradingview-parsers.md`); raw files are preserved; nothing is sent to a
  model.
- ARF independently recomputes the ledger, equity, drawdown and metrics and
  produces a parity report (`PASS`, `WARN`, `FAIL`, `INSUFFICIENT_DATA`) that
  reports the first divergence.
- A failed parse leaves the verification in `PARSE_FAILED`; the operator can
  upload a replacement (the old upload is superseded, never deleted) or start a
  new verification.

## Alternatives

- **Browser automation (Playwright or similar against tradingview.com).**
  Rejected: terms-of-service risk, fragile selectors, credential handling and
  CAPTCHA/2FA make it unsuitable as a core dependency.
- **Screenshot or PDF ingestion.** Rejected: CSV exports are structured and
  screenshots must never be canonical when structured data exists.
- **Local runner only.** Needed for scale later, but it cannot be the
  acceptance environment for Pine semantics.

## Consequences

- Verification throughput is limited by people; this is acceptable for the
  paper-approval gate.
- The attestation is a human statement, recorded and audited; it is not proof.
  Parity checks catch many mismatches (trade count, P&L sequence, window).

## Security implications

Uploads are size- and checksum-bound, rate limited, organisation-scoped and
audited. Raw exports are stored under the organisation's key prefix.

## Migration/rollback

If TradingView offers a supported export API, a new ingestion source can feed
the same parser and parity pipeline; existing verifications are unaffected.

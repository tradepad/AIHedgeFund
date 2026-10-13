# Vertical slice progress

Tracks the milestones in `CLAUDE_CODE_BUILD_PROMPT.md`.

| # | Milestone | Status | Where |
|---|-----------|--------|-------|
| 1 | Repository and tooling | done | root workspace, turbo, ESLint, Prettier |
| 2 | Contracts | done | `packages/contracts` |
| 3 | Database | done | `packages/db` (migrations `0000`, `0001`) |
| 4 | Auth and organisation boundary | done | `packages/auth`, `apps/api/src/http/auth.ts` |
| 5 | Workflow and audit | done | `packages/workflow`, `packages/db/src/audit.ts` |
| 6 | Strategy registry | done | `apps/api/src/services/registry.ts` |
| 7 | Object storage and verification uploads | done | `packages/storage`, `apps/api/src/services/verifications.ts` |
| 8 | Report parsing | done | `packages/pine/src/tradingview`, `apps/worker-backtest` |
| 9 | Metrics, equity, parity | done | `packages/metrics`, `apps/worker-analytics` |
| 10 | API | done | `apps/api` |
| 11 | Frontend | done | `apps/web`, `packages/ui` |
| 12 | Worker integration | done | outbox relay, orchestrator, BullMQ workers |
| 13 | Tests | done | unit tests per package, `tests/integration`, `apps/web/e2e` |
| 14 | Documentation and local setup | done | `README.md`, `.env.example`, `docs/` |

## Known limitations of this slice

- TradingView fixtures are synthetic; no real export has been run through the
  parsers yet. New export layouts need new adapters.
- No local Pine runner; TradingView exports are the only backtest source.
- Only the deterministic fixture model provider exists; no real model is wired.
- The API verifies Clerk tokens, but the web app has development sign-in only.
- `worker-forward` is a health-checked shell; there is no webhook or paper engine.
- Point value is assumed to be 1 (spot and linear perpetuals).
- No validator agent; the parity report and ARF metrics are the validation evidence.

## Next milestone

Forward webhook and paper engine (build order step 15) after a local
Pine-compatible runner and robustness validation (steps 12 and 13): runner
adapter behind `@arf/backtest-sdk` with the golden fixture suite, data-segment
generation with protected holdout access, validation reports, and Clerk
sign-in in the web app.

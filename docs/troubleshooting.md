# Troubleshooting

## Services

**`ECONNREFUSED 127.0.0.1:5432` or `:6379`.** PostgreSQL or Redis is not
running. `pnpm services:up` starts both with Docker Compose, or with locally
installed binaries when no Docker daemon is reachable (data under `.data/`).

**Integration or e2e tests fail creating a database.** The tests connect to
`postgres://arf@127.0.0.1:5432/postgres` and create throwaway `arf_it_*`
databases, so the `arf` role needs `CREATEDB`. Override with
`ARF_TEST_ADMIN_DATABASE_URL`. Tests use Redis database 15
(`ARF_TEST_REDIS_URL`) and clear its queues.

**Leftover `arf_it_*` databases** after an interrupted run are safe to drop:
`psql -d postgres -c 'DROP DATABASE <name> WITH (FORCE)'`.

## Configuration

**`invalid configuration: LOCAL_STORAGE_DIR …`.** The local storage driver
needs an absolute directory so the API and every worker read and write the
same files regardless of working directory.

**`dev auth is not allowed in production`.** `AUTH_MODE=dev` is refused when
`NODE_ENV=production`. Use Clerk.

**Processes do not see `.env`.** API, worker and database scripts load the
repository-root `.env` via `--env-file-if-exists=../../.env`. Next.js reads
`apps/web/.env*`; the web app only needs `ARF_API_URL` and `ARF_AUTH_MODE`,
whose defaults suit local development.

## Uploads and verification

**Presigned upload returns 403 `UPLOAD_REJECTED`.** The token expired, or the
bytes differ from the declared size or SHA-256. The browser computes the hash
from the same bytes it uploads; re-select the file and retry.

**Upload works from curl but not from the browser.** `UPLOAD_PUBLIC_BASE_URL`
must point at the web app's proxy (`http://localhost:3000/arf-api`) so the
browser uploads same-origin. Pointing it at the API directly needs CORS.

**Completion returns 422 `ATTESTED_SOURCE_MISMATCH`.** The attested Pine hash
must be the source hash of the revision under verification. Load exactly that
source into TradingView.

**Verification stuck in `PROCESSING`.** Check the jobs table on the
verification page (or `GET /v1/tradingview-verifications/:id`). If no jobs
appear, the outbox relay is not running (`OUTBOX_RELAY_ENABLED`) or Redis is
down. If a job shows `FAILED_TERMINAL`, its `lastErrorCode` names the cause.
Also confirm `worker-backtest` and `worker-analytics` are running
(`curl localhost:4101/readyz`, `curl localhost:4102/readyz`).

**`PARSE_FAILED` with `AMBIGUOUS_NUMBER_LOCALE` or `AMBIGUOUS_DATE_FORMAT`.**
The export does not contain enough evidence to tell `1,234` from `1.234`, or
DD/MM from MM/DD. Create a new verification with the number-format and
date-order hints set. See `docs/tradingview-parsers.md`.

## Decisions

**`PAPER_APPROVED` is disabled or refused (422 `HARD_FAIL`, `EVIDENCE_MISSING` or `OVERRIDE_REQUIRED`; 409 `INVALID_STATE` outside paper-approval review).** Mandatory evidence is
missing or there is a hard failure (parity `FAIL`, lint hard errors, a failed
parse). These cannot be overridden. Warnings (`PARITY_WARN`,
`LOW_TRADE_COUNT`, `PINE_LINT_WARNINGS`, `PARSER_WARNINGS`) need an explicit
human override with a reason.

**`409 STALE_EVIDENCE`.** A newer parity report exists than the one the
decision cites. Reload the decision page.

**`403` on a decision.** The decider needs `decision:write` (committee member
or admin) and must not be an author of the version.

## Web and e2e

**Playwright cannot find Chromium.** Set `PLAYWRIGHT_BROWSERS_PATH`, or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a Chromium binary. Do not run
`playwright install` in environments that pre-install browsers.

**e2e ports in use.** The suite uses API port 4400 and web port 3100;
override with `E2E_API_PORT` and `E2E_WEB_PORT`.

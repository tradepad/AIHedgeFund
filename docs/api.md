# API reference and examples

Base URL in development: `http://127.0.0.1:4000`. All routes are under `/v1`
except `/healthz` and `/readyz`. Request and response bodies are validated
with the schemas in `@arf/contracts`.

## Conventions

- **Authentication.** `Authorization: Bearer <token>`. With `AUTH_MODE=dev`
  the token is `dev:<subject>` for a seeded development user (for example
  `dev:dev|researcher`). With `AUTH_MODE=clerk` it is a Clerk session token.
- **Organisation.** `X-Arf-Org: <slug>` selects the organisation. It is
  checked against the caller's memberships; it is never trusted on its own.
- **Commands** (`POST`, `PUT`) require `Idempotency-Key`. Replaying the same
  key and body returns the stored response with `Idempotency-Replayed: true`;
  the same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`.
- **Errors** are RFC 9457 problem details:
  `{ type, title, status, detail, instance, code, traceId, errors? }`.
  Expected policy rejections (for example a transition without evidence) are
  `409` or `422` with a specific `code`.
- **Pagination** uses opaque cursors: `?limit=50&cursor=…`, response
  `{ items, nextCursor }`.
- **Rate limits** apply per credential to upload reservation, upload
  completion and decision endpoints (`429` with `Retry-After`).

## Endpoints

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /v1/campaigns` · `GET /v1/campaigns` · `GET /v1/campaigns/:id` | campaign:write · read | Campaigns |
| `GET /v1/campaigns/:id/tasks` · `/ideas` · `/audit` | read | Campaign detail |
| `POST /v1/campaigns/:id/ideas` | idea:write | Record a structured Idea Card |
| `POST /v1/campaigns/:id/ideas/generate` | idea:write | Ask IDEA_SCOUT (202, asynchronous) |
| `GET /v1/ideas/:id` | read | Idea Card |
| `POST /v1/strategies` · `GET /v1/strategies/:id` | strategy:write · read | Strategies |
| `POST /v1/strategies/:id/versions` | strategy:write | Root or child version (child records lineage and changed fields) |
| `GET /v1/strategy-versions/:id` · `/lineage` | read | Version and lineage |
| `PUT` · `GET /v1/strategy-versions/:id/definition` | strategy:write · read | Strategy Definition (write-once) |
| `GET /v1/strategy-versions/:id/pine/template` | read | Approved template output for the definition |
| `PUT` · `GET /v1/strategy-versions/:id/pine` | pine:write · read | Pine v6 revision and manifest (lint hard errors → 422) |
| `POST` · `GET /v1/strategy-versions/:id/transitions` | workflow:transition · read | Lifecycle transitions through the workflow engine |
| `POST /v1/tradingview-verifications` | verification:write | Create a verification with a settings snapshot |
| `GET /v1/strategy-versions/:id/verifications` · `GET /v1/tradingview-verifications/:id` | read | Verification status, uploads and jobs |
| `POST /v1/tradingview-verifications/:id/uploads` | report:upload | Reserve a presigned upload |
| `POST /v1/tradingview-verifications/:id/uploads/complete` | report:upload | Verify size, checksum and attestation; queue parsing |
| `GET /v1/tradingview-verifications/:id/events` | read | Server-sent progress events |
| `GET /v1/tradingview-verifications/:id/parity` | read | Parity report |
| `GET /v1/backtest-runs/:id` · `/trades` · `/equity` · `/metrics` | read | Results (labelled historical simulation) |
| `GET /v1/strategy-versions/:id/external-evidence` | read | Imported external results and source for a version (ADR 0005) |
| `GET /v1/strategy-versions/:id/decision-context` | read | Evidence computed by the server for a decision |
| `POST /v1/committee/decisions` | decision:write | Record REJECT, REWORK_WITH_NEW_VERSION or PAPER_APPROVED |
| `GET /v1/command-centre` · `GET /v1/strategy-library` | read | Oversight views |
| `GET /v1/strategy-versions/:id/audit` | read | Version audit timeline |
| `GET /v1/audit` · `GET /v1/audit/verify` | audit:read | Organisation audit log and hash-chain verification |
| `GET /v1/artefacts/:id/content` | read; protected:read for PROTECTED | Artefact bytes (protected reads are audited) |
| `PUT /v1/object-uploads/:token` | signed token | Local storage driver only: receives presigned uploads |

## Walkthrough with curl

```bash
API=http://127.0.0.1:4000
R=(-H 'authorization: Bearer dev:dev|researcher' -H 'x-arf-org: arf-dev' -H 'content-type: application/json')
key() { echo "idempotency-key: $(uuidgen)"; }

# Campaign
CAMPAIGN=$(curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/campaigns \
  -d '{"name":"BTC trend","objective":"Find robust crypto trend pullback strategies","assetClasses":["crypto"],"timeframes":["60"]}' | jq -r .id)

# Ask the IDEA_SCOUT fixture provider for an idea (asynchronous)
curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/campaigns/$CAMPAIGN/ideas/generate \
  -d '{"objective":"trend continuation on BTC perpetuals after pullbacks"}'
IDEA=$(curl -s "${R[@]}" $API/v1/campaigns/$CAMPAIGN/ideas | jq -r '.items[0].id')

# Strategy and root version
STRATEGY=$(curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/strategies \
  -d "{\"campaignId\":\"$CAMPAIGN\",\"name\":\"Trend pullback\",\"family\":\"trend_following\",\"ideaCardId\":\"$IDEA\"}" | jq -r .id)
VERSION=$(curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/strategies/$STRATEGY/versions \
  -d '{"kind":"ROOT","symbol":"BYBIT:BTCUSDT.P","timeframe":"60","changeReason":"initial hypothesis"}' | jq -r .id)

# Strategy Definition (body: {"definition": <SDL 1.0.0 document>}, see exampleStrategyDefinition)
DEF=$(curl -s "${R[@]}" -H "$(key)" -X PUT $API/v1/strategy-versions/$VERSION/definition -d @definition.json | jq -r .id)
curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/strategy-versions/$VERSION/transitions \
  -d "{\"to\":\"PINE_DEVELOPMENT\",\"reasonCodes\":[\"SDL_COMPLETE\"],\"summary\":\"definition attached\",\"evidenceIds\":[\"$DEF\"]}"

# Pine revision from the approved template
curl -s "${R[@]}" "$API/v1/strategy-versions/$VERSION/pine/template?initialCapital=10000&currency=USDT" \
  | jq '{source, manifest}' > pine.json
PINE=$(curl -s "${R[@]}" -H "$(key)" -X PUT $API/v1/strategy-versions/$VERSION/pine -d @pine.json)
PINE_ID=$(echo "$PINE" | jq -r .id); PINE_HASH=$(echo "$PINE" | jq -r .sourceHash)
curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/strategy-versions/$VERSION/transitions \
  -d "{\"to\":\"TRADINGVIEW_VERIFICATION\",\"reasonCodes\":[\"PINE_READY\"],\"summary\":\"lint passed\",\"evidenceIds\":[\"$DEF\",\"$PINE_ID\"]}"

# Verification and one upload (repeat for LIST_OF_TRADES)
VER=$(curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/tradingview-verifications \
  -d "{\"strategyVersionId\":\"$VERSION\",\"chartTimezone\":\"Etc/UTC\",\"dateFrom\":\"2024-01-01\",\"dateTo\":\"2024-04-30\"}" | jq -r .id)
F=pine/fixtures/tradingview/classic-performance-summary.csv
SLOT=$(curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/tradingview-verifications/$VER/uploads \
  -d "{\"reportType\":\"PERFORMANCE_SUMMARY\",\"fileName\":\"summary.csv\",\"contentType\":\"text/csv\",\"sizeBytes\":$(wc -c < $F),\"sha256\":\"$(sha256sum $F | cut -d' ' -f1)\"}")
curl -s -X PUT -H 'content-type: text/csv' --data-binary @$F "$(echo "$SLOT" | jq -r .url)"
curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/tradingview-verifications/$VER/uploads/complete \
  -d "{\"uploadId\":\"$(echo "$SLOT" | jq -r .uploadId)\",\"attestedPineSourceHash\":\"$PINE_HASH\",\"attestedSettingsMatch\":true}"

# Follow progress, then read parity
curl -sN "${R[@]}" $API/v1/tradingview-verifications/$VER/events
curl -s "${R[@]}" $API/v1/tradingview-verifications/$VER/parity | jq '{status, firstDivergence}'

# Submit for review, then decide as an independent committee member
curl -s "${R[@]}" -H "$(key)" -X POST $API/v1/strategy-versions/$VERSION/transitions \
  -d '{"to":"PAPER_APPROVAL_REVIEW","reasonCodes":["VERIFICATION_COMPLETE"],"summary":"verification and parity complete","evidenceIds":[]}'
C=(-H 'authorization: Bearer dev:dev|committee' -H 'x-arf-org: arf-dev' -H 'content-type: application/json')
PARITY=$(curl -s "${C[@]}" $API/v1/strategy-versions/$VERSION/decision-context | jq -r .evidence.parityReportId)
curl -s "${C[@]}" -H "$(key)" -X POST $API/v1/committee/decisions -d "{
  \"strategyVersionId\":\"$VERSION\",\"decision\":\"REJECT\",\"reasonCodes\":[\"LOW_TRADE_COUNT\"],
  \"summary\":\"Twelve trades cannot support a paper deployment.\",
  \"rejectionCase\":\"The sample is too small and parity is only WARN.\",
  \"parityReportId\":\"$PARITY\",\"acknowledgement\":true}"
```

For `PAPER_APPROVAL_REVIEW` the server computes the evidence itself; any
client-supplied evidence ids are ignored. `PAPER_APPROVED` is refused while
mandatory evidence is missing or parity is `FAIL`, and requires
`humanOverride: true` with an `overrideReason` when warnings such as
`PARITY_WARN` or `LOW_TRADE_COUNT` are present. A decision citing an older
parity report is `409 STALE_EVIDENCE`.

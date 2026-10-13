# Development fixtures

> [!WARNING]
> Everything in `pine/fixtures/tradingview` is **synthetic development data**.
> It was generated, not exported from TradingView, and says nothing about any
> real strategy or market. It exists only to exercise parsers, the evidence
> pipeline and the UI in tests and local development.

## TradingView exports

`pine/fixtures/tradingview` holds one deterministic 12-trade ledger on
`BYBIT:BTCUSDT.P`, 60-minute bars, 2024-01-01 to 2024-04-30, initial capital
10,000 USDT, 0.06% commission per side, rendered in two export layouts:

| Files | Layout | Chart timezone | Numbers | Dates |
|---|---|---|---|---|
| `classic-performance-summary.csv`, `classic-list-of-trades.csv` | classic (`,` delimited) | `Etc/UTC` | `1234.56` | `YYYY-MM-DD HH:mm` |
| `pnl-performance-summary.csv`, `pnl-list-of-trades.csv` | newer P&L layout (`;` delimited) | `America/New_York` | `1234,56` | `DD.MM.YYYY HH:mm` |

Generator: `packages/pine/scripts/generate-fixtures.ts`. Per-trade P&L follows
the declared cost model, so ARF's recomputation reproduces it. The summary's
max drawdown is set above the closed-trade drawdown, as TradingView's intrabar
drawdown would be. Fixture bytes are preserved exactly
(`.gitattributes` disables line-ending conversion for them) because uploads are checksummed.

Expected results for the classic pair:

| Value | Expected |
|---|---|
| Closed trades | 12 |
| ARF net profit | 201.088679320000 USDT |
| ARF final closed equity | 10201.088679320000 USDT |
| TradingView-reported net profit | 201.09 USDT |
| Parity | `WARN`: net profit and trade count pass; ARF's closed-trade drawdown is below the reported intrabar drawdown, which is reported as a warning by design |

The integration tests also derive failing variants from these files at run
time, for example moving one exit price so parity is `FAIL`.

## Pine

`pine/fixtures/golden/trend_pullback.pine` and its manifest are the golden
output of the approved template for the example Strategy Definition
(`exampleStrategyDefinition` in `@arf/contracts`). The Pine tests fail if the
template output drifts. Regenerate deliberately with
`pnpm --filter @arf/pine exec tsx scripts/write-golden.ts` (the CSV fixtures: `pnpm --filter @arf/pine fixtures:generate`) and review the diff.

## Model output

`worker-research` uses `FixtureModelProvider` (`MODEL_PROVIDER=fixture`). It
returns a schema-valid Idea Card built from the task objective. Modes
`invalid-then-valid` and `always-invalid` exercise the repair retry and the
failure path. No real model provider is wired in this slice.

## Development users

`pnpm db:seed` creates two organisations. These identities only work with
`AUTH_MODE=dev`, which the API refuses in production.

| Subject | Organisation | Roles |
|---|---|---|
| `dev|researcher` | `arf-dev` | RESEARCHER, DEVELOPER |
| `dev|committee` | `arf-dev` | COMMITTEE_MEMBER, VALIDATOR |
| `dev|operator` | `arf-dev` | OPERATOR |
| `dev|viewer` | `arf-dev` | VIEWER |
| `dev|admin` | `arf-dev` | ADMIN |
| `dev|outsider` | `arf-other` | ADMIN (used to prove organisation isolation) |

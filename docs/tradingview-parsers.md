# TradingView report parsers

Code: `packages/pine/src/tradingview/` (`csv.ts`, `locale.ts`, `reports.ts`).
Tests: `packages/pine/test`.

The parsers turn a TradingView Strategy Tester CSV export into typed rows
without guessing. The raw upload is always preserved as an artefact and the
parsed result records the adapter id and version that produced it.
TradingView exports are never sent to a model.

## Pipeline

1. **Decode.** UTF-8 (BOM stripped) or UTF-16LE with a BOM. Invalid UTF-8 is
   rejected (`ENCODING_ERROR`).
2. **Tokenise.** RFC 4180 quoting. The delimiter is chosen among `,` `;` and
   tab by requiring a consistent column count; if more than one delimiter
   fits, the file is rejected (`AMBIGUOUS_DELIMITER`).
3. **Identify the report.** The header is matched against versioned adapters.
   No match: `UNKNOWN_REPORT_FORMAT`. More than one: `AMBIGUOUS_REPORT_FORMAT`.
   A match of the wrong type for the upload slot: `REPORT_TYPE_MISMATCH`.
4. **Numbers.** Dot-decimal or comma-decimal is decided from evidence in the
   file (for example `42350,5` or `1.234,56`). A file that mixes conventions,
   or whose only numbers are ambiguous (such as `1,234`) without a hint on the
   verification, is rejected (`AMBIGUOUS_NUMBER_LOCALE`). A hint that
   contradicts the evidence is rejected (`LOCALE_HINT_CONFLICT`).
5. **Dates.** `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY` and `MM/DD/YYYY` with
   an optional time. DD/MM versus MM/DD is decided only when some day is above
   12, or by the verification's date-order hint; otherwise
   `AMBIGUOUS_DATE_FORMAT`. Local times are interpreted in the verification's
   chart timezone and converted to UTC with Luxon. Times in a daylight-saving
   gap are rejected; times in a fall-back hour use the earlier instant and
   emit `AMBIGUOUS_LOCAL_TIME`.
6. **Rows to trades.** Entry and exit rows are paired by trade number.
   Missing required columns or values fail the parse with the row number.

## Adapters

| Adapter | Version | Report | Recognised by |
|---|---|---|---|
| `tv-list-of-trades-classic` | 1.0.0 | List of Trades | `Trade #, Type, Signal, Date/Time, Price <CCY>, Contracts, Profit <CCY>, …` |
| `tv-list-of-trades-pnl` | 2.0.0 | List of Trades | `Trade #, Type, Date and time, Signal, Price <CCY>, Position size (qty), Net P&L <CCY>, …` |
| `tv-performance-summary-classic` | 1.0.0 | Performance Summary | blank or `Title` label column, Title Case labels, `All <CCY>` and `All %` columns |
| `tv-performance-summary-metric` | 2.0.0 | Performance Summary | `Metric` label column, sentence-case labels, `All <CCY>` and `All %` columns |

Column meaning is defined in the adapter and nowhere else. A column the
adapter does not map is kept in the raw rows and reported as
`UNMAPPED_COLUMN`; its meaning is never inferred. All currency-suffixed
columns must name the same currency (`CURRENCY_INCONSISTENT`).

Adding a layout means adding a new adapter with a new id or version and
fixtures for it. Do not change the meaning of an existing adapter version:
parsed artefacts record the version that produced them, and the trades job
refuses a parsed artefact whose parser version does not match.

## Warnings

Warnings are stored on the upload, shown in the UI and count as
`PARSER_WARNINGS` evidence, which requires an explicit human override to
approve for paper.

| Code | Meaning |
|---|---|
| `UNMAPPED_COLUMN` | Column preserved but not interpreted |
| `LOCALE_FROM_HINT_OR_EVIDENCE` | Ambiguous numbers were resolved by the hint or other evidence in the file |
| `OPEN_TRADE_EXCLUDED` | A trade without an exit is excluded from closed-trade analysis |
| `PNL_ROW_MISMATCH` | Entry and exit rows report different P&L; the exit row is used |
| `AMBIGUOUS_LOCAL_TIME` | Times in a fall-back hour; earlier instant used |
| `TRADE_NUMBER_GAP` | Trade numbers are not consecutive |

## What ARF recomputes

For each closed trade ARF recomputes gross P&L from prices and quantity, and
commission from the manifest's cost model, then net P&L. Equity, drawdown and
metrics are calculated from ARF's own numbers (`arf-equity/1.0.0`,
`arf-metrics/1.0.0`). TradingView-reported values are stored separately with
`source = TRADINGVIEW_REPORTED` and only meet ARF's values in the parity
report (`arf-parity/1.0.0`), which checks identity first, then the trade
sequence, then aggregates, and reports the first divergence.

Point value is assumed to be 1 (spot and linear perpetuals). Contracts with a
different point value are a known limitation of this slice.

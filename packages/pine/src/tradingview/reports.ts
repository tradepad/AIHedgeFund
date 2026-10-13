import Decimal from "decimal.js";
import type { DateOrder, NumberLocale, ParserWarning, ReportType, TradeDirection } from "@arf/contracts";
import { readCsv, type CsvFailure, type Delimiter } from "./csv";
import { detectDateOrder, detectNumberLocale, parseChartTime, parseDecimal, type LocaleFailure } from "./locale";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface ParsedTrade {
  tradeNumber: number;
  direction: TradeDirection;
  entryTime: string;
  entryPrice: string;
  entrySignal: string | null;
  exitTime: string;
  exitPrice: string;
  exitSignal: string | null;
  quantity: string;
  reportedNetPnl: string | null;
  reportedNetPnlPct: string | null;
  reportedCumulativePnl: string | null;
  /** 1-based file row numbers of the entry and exit rows. */
  rawRowNumbers: number[];
}

export const SUMMARY_METRIC_KEYS = [
  "net_profit",
  "gross_profit",
  "gross_loss",
  "max_drawdown",
  "profit_factor",
  "commission_paid",
  "total_closed_trades",
  "total_open_trades",
  "winning_trades",
  "losing_trades",
  "percent_profitable",
  "initial_capital",
  "open_pl",
] as const;
export type SummaryMetricKey = (typeof SUMMARY_METRIC_KEYS)[number];

export interface SummaryMetric {
  key: SummaryMetricKey;
  label: string;
  /** Value in the report currency or as a plain number (counts, ratios). */
  value: string | null;
  /** Value from the "All %" column, in percentage points, where present. */
  valuePct: string | null;
  row: number;
}

export type ReportData =
  | { kind: "LIST_OF_TRADES"; trades: ParsedTrade[]; openTradesExcluded: number }
  | { kind: "PERFORMANCE_SUMMARY"; metrics: SummaryMetric[]; unmappedRows: { label: string; row: number }[] };

export interface ParsedReport {
  reportType: ReportType;
  parserId: string;
  parserVersion: string;
  delimiter: Delimiter;
  numberLocale: NumberLocale;
  dateOrder: DateOrder;
  currency: string;
  warnings: ParserWarning[];
  /** Every row of the file exactly as read, header first. */
  rawRows: string[][];
  data: ReportData;
}

export type ParseFailureCode =
  | CsvFailure["code"]
  | LocaleFailure["code"]
  | "UNKNOWN_REPORT_FORMAT"
  | "AMBIGUOUS_REPORT_FORMAT"
  | "REPORT_TYPE_MISMATCH"
  | "MISSING_REQUIRED_COLUMN"
  | "MISSING_REQUIRED_VALUE"
  | "CURRENCY_INCONSISTENT"
  | "INVALID_TRADE";

export interface ParseFailure {
  code: ParseFailureCode;
  detail: string;
  row: number | null;
  warnings: ParserWarning[];
}

export interface ParseOptions {
  expectedType: ReportType;
  chartTimezone: string;
  numberLocaleHint: NumberLocale | null;
  dateOrderHint: DateOrder | null;
}

// ---------------------------------------------------------------------------
// Versioned adapters. Column meaning is defined here and nowhere else; a
// header that no adapter maps is preserved and reported, never interpreted.
// ---------------------------------------------------------------------------
type ColumnKind = "int" | "decimal" | "text" | "datetime" | "type";

interface ColumnSpec {
  key: string;
  header: RegExp;
  required: boolean;
  kind: ColumnKind;
}

interface TradesAdapter {
  reportType: "LIST_OF_TRADES";
  id: string;
  version: string;
  description: string;
  columns: ColumnSpec[];
}

interface SummaryAdapter {
  reportType: "PERFORMANCE_SUMMARY";
  id: string;
  version: string;
  description: string;
  labelHeader: RegExp;
  valueHeader: RegExp;
  pctHeader: RegExp;
  labels: Record<SummaryMetricKey, readonly string[]>;
}

type Adapter = TradesAdapter | SummaryAdapter;

const CCY = "([A-Z]{3,5})";

export const TRADES_CLASSIC_V1: TradesAdapter = {
  reportType: "LIST_OF_TRADES",
  id: "tv-list-of-trades-classic",
  version: "1.0.0",
  description: "List of Trades export with Date/Time, Contracts and Profit columns",
  columns: [
    { key: "tradeNumber", header: /^Trade #$/, required: true, kind: "int" },
    { key: "type", header: /^Type$/, required: true, kind: "type" },
    { key: "signal", header: /^Signal$/, required: true, kind: "text" },
    { key: "time", header: /^Date\/Time$/, required: true, kind: "datetime" },
    { key: "price", header: new RegExp(`^Price ${CCY}$`), required: true, kind: "decimal" },
    { key: "quantity", header: /^Contracts$/, required: true, kind: "decimal" },
    { key: "netPnl", header: new RegExp(`^Profit ${CCY}$`), required: true, kind: "decimal" },
    { key: "netPnlPct", header: /^Profit %$/, required: false, kind: "decimal" },
    { key: "cumPnl", header: new RegExp(`^Cum\\. Profit ${CCY}$`), required: false, kind: "decimal" },
    { key: "cumPnlPct", header: /^Cum\. Profit %$/, required: false, kind: "decimal" },
    { key: "runUp", header: new RegExp(`^Run-up ${CCY}$`), required: false, kind: "decimal" },
    { key: "runUpPct", header: /^Run-up %$/, required: false, kind: "decimal" },
    { key: "drawdown", header: new RegExp(`^Drawdown ${CCY}$`), required: false, kind: "decimal" },
    { key: "drawdownPct", header: /^Drawdown %$/, required: false, kind: "decimal" },
  ],
};

export const TRADES_PNL_V2: TradesAdapter = {
  reportType: "LIST_OF_TRADES",
  id: "tv-list-of-trades-pnl",
  version: "2.0.0",
  description: "List of Trades export with Date and time, Position size and Net P&L columns",
  columns: [
    { key: "tradeNumber", header: /^Trade #$/, required: true, kind: "int" },
    { key: "type", header: /^Type$/, required: true, kind: "type" },
    { key: "time", header: /^Date and time$/, required: true, kind: "datetime" },
    { key: "signal", header: /^Signal$/, required: true, kind: "text" },
    { key: "price", header: new RegExp(`^Price ${CCY}$`), required: true, kind: "decimal" },
    { key: "quantity", header: /^Position size \(qty\)$/, required: true, kind: "decimal" },
    { key: "notional", header: new RegExp(`^Position size \\(value\\)(?: ${CCY})?$`), required: false, kind: "decimal" },
    { key: "netPnl", header: new RegExp(`^Net P&L ${CCY}$`), required: true, kind: "decimal" },
    { key: "netPnlPct", header: /^Net P&L %$/, required: false, kind: "decimal" },
    { key: "favourable", header: new RegExp(`^Favorable excursion ${CCY}$`), required: false, kind: "decimal" },
    { key: "favourablePct", header: /^Favorable excursion %$/, required: false, kind: "decimal" },
    { key: "adverse", header: new RegExp(`^Adverse excursion ${CCY}$`), required: false, kind: "decimal" },
    { key: "adversePct", header: /^Adverse excursion %$/, required: false, kind: "decimal" },
    { key: "cumPnl", header: new RegExp(`^Cumulative P&L ${CCY}$`), required: false, kind: "decimal" },
    { key: "cumPnlPct", header: /^Cumulative P&L %$/, required: false, kind: "decimal" },
  ],
};

export const SUMMARY_CLASSIC_V1: SummaryAdapter = {
  reportType: "PERFORMANCE_SUMMARY",
  id: "tv-performance-summary-classic",
  version: "1.0.0",
  description: "Performance Summary with a blank or 'Title' label column and Title Case row labels",
  labelHeader: /^(|Title)$/,
  valueHeader: new RegExp(`^All ${CCY}$`),
  pctHeader: /^All %$/,
  labels: {
    net_profit: ["Net Profit"],
    gross_profit: ["Gross Profit"],
    gross_loss: ["Gross Loss"],
    max_drawdown: ["Max Drawdown"],
    profit_factor: ["Profit Factor"],
    commission_paid: ["Commission Paid"],
    total_closed_trades: ["Total Closed Trades"],
    total_open_trades: ["Total Open Trades"],
    winning_trades: ["Number Winning Trades"],
    losing_trades: ["Number Losing Trades"],
    percent_profitable: ["Percent Profitable"],
    initial_capital: ["Initial Capital"],
    open_pl: ["Open PL"],
  },
};

export const SUMMARY_METRIC_V2: SummaryAdapter = {
  reportType: "PERFORMANCE_SUMMARY",
  id: "tv-performance-summary-metric",
  version: "2.0.0",
  description: "Performance Summary with a 'Metric' label column and sentence-case row labels",
  labelHeader: /^Metric$/,
  valueHeader: new RegExp(`^All ${CCY}$`),
  pctHeader: /^All %$/,
  labels: {
    net_profit: ["Net profit"],
    gross_profit: ["Gross profit"],
    gross_loss: ["Gross loss"],
    max_drawdown: ["Max equity drawdown", "Max equity drawdown (intrabar)"],
    profit_factor: ["Profit factor"],
    commission_paid: ["Commission paid"],
    total_closed_trades: ["Total trades", "Total closed trades"],
    total_open_trades: ["Total open trades"],
    winning_trades: ["Winning trades"],
    losing_trades: ["Losing trades"],
    percent_profitable: ["Percent profitable"],
    initial_capital: ["Initial capital"],
    open_pl: ["Open P&L"],
  },
};

export const REPORT_ADAPTERS: readonly Adapter[] = [TRADES_CLASSIC_V1, TRADES_PNL_V2, SUMMARY_CLASSIC_V1, SUMMARY_METRIC_V2];

const REQUIRED_SUMMARY_KEYS: SummaryMetricKey[] = ["net_profit", "total_closed_trades"];

// ---------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------
interface TradesMatch {
  adapter: TradesAdapter;
  columnIndex: Map<string, number>;
  currencies: Set<string>;
  unmapped: string[];
}

function matchTradesAdapter(adapter: TradesAdapter, header: string[]): { match: TradesMatch | null; missing: string[] } {
  const columnIndex = new Map<string, number>();
  const currencies = new Set<string>();
  const used = new Set<number>();
  for (const spec of adapter.columns) {
    const idx = header.findIndex((h, i) => !used.has(i) && spec.header.test(h.trim()));
    if (idx >= 0) {
      used.add(idx);
      columnIndex.set(spec.key, idx);
      const ccy = spec.header.exec(header[idx]?.trim() ?? "")?.[1];
      if (ccy) currencies.add(ccy);
    }
  }
  const missing = adapter.columns.filter((c) => c.required && !columnIndex.has(c.key)).map((c) => c.header.source);
  if (missing.length > 0) return { match: null, missing };
  const unmapped = header.filter((_h, i) => !used.has(i)).map((h) => h.trim());
  return { match: { adapter, columnIndex, currencies, unmapped }, missing };
}

function failure(code: ParseFailureCode, detail: string, row: number | null = null, warnings: ParserWarning[] = []): { ok: false; error: ParseFailure } {
  return { ok: false, error: { code, detail, row, warnings } };
}

/**
 * Parse one TradingView Strategy Tester export. The file is identified by
 * its header against the versioned adapters; the caller's expected type must
 * agree. Raw rows are always returned so the original evidence is preserved.
 */
export function parseTradingViewReport(bytes: Uint8Array, options: ParseOptions): { ok: true; report: ParsedReport } | { ok: false; error: ParseFailure } {
  const csv = readCsv(bytes);
  if (!csv.ok) return failure(csv.error.code, csv.error.detail);
  const { rows, delimiter } = csv.table;
  const header = rows[0] ?? [];

  const tradeMatches = [TRADES_CLASSIC_V1, TRADES_PNL_V2].map((a) => matchTradesAdapter(a, header));
  const summaryMatches = [SUMMARY_CLASSIC_V1, SUMMARY_METRIC_V2].filter(
    (a) =>
      a.labelHeader.test(header[0]?.trim() ?? "") &&
      header.some((h) => a.valueHeader.test(h.trim())),
  );
  const matchedTrades = tradeMatches.flatMap((m) => (m.match ? [m.match] : []));
  const total = matchedTrades.length + summaryMatches.length;
  if (total === 0) {
    const closest = tradeMatches.reduce((a, b) => (a.missing.length <= b.missing.length ? a : b));
    return failure(
      "UNKNOWN_REPORT_FORMAT",
      `header does not match any known export format; closest list-of-trades format is missing columns ${closest.missing.join(", ")}`,
      1,
    );
  }
  if (total > 1) return failure("AMBIGUOUS_REPORT_FORMAT", "header matches more than one export format", 1);

  const tradesMatch = matchedTrades[0];
  const detectedType: ReportType = tradesMatch ? "LIST_OF_TRADES" : "PERFORMANCE_SUMMARY";
  if (detectedType !== options.expectedType) {
    return failure("REPORT_TYPE_MISMATCH", `file is a ${detectedType} export but was uploaded as ${options.expectedType}`, 1);
  }
  if (tradesMatch) return parseTrades(rows, delimiter, tradesMatch, options);
  const summaryAdapter = summaryMatches[0];
  if (!summaryAdapter) return failure("UNKNOWN_REPORT_FORMAT", "no summary adapter matched", 1);
  return parseSummary(rows, delimiter, summaryAdapter, options);
}

// ---------------------------------------------------------------------------
// List of Trades
// ---------------------------------------------------------------------------
interface TradeRow {
  row: number;
  tradeNumber: number;
  side: "entry" | "exit";
  direction: TradeDirection;
  signal: string | null;
  timeRaw: string;
  price: string | null;
  quantity: string | null;
  netPnl: string | null;
  netPnlPct: string | null;
  cumPnl: string | null;
}

function parseTrades(
  rows: string[][],
  delimiter: Delimiter,
  match: TradesMatch,
  options: ParseOptions,
): { ok: true; report: ParsedReport } | { ok: false; error: ParseFailure } {
  const warnings: ParserWarning[] = [];
  const { adapter, columnIndex } = match;
  if (match.currencies.size !== 1) {
    return failure("CURRENCY_INCONSISTENT", `columns declare currencies ${[...match.currencies].join(", ") || "none"}`, 1);
  }
  const currency = [...match.currencies][0] ?? "";
  for (const col of match.unmapped) {
    warnings.push({ code: "UNMAPPED_COLUMN", message: `column "${col}" is not mapped by ${adapter.id}@${adapter.version}; preserved in raw rows only`, row: 1, column: col });
  }
  const cell = (r: string[], key: string): string => {
    const idx = columnIndex.get(key);
    return idx === undefined ? "" : (r[idx] ?? "").trim();
  };

  const decimalKeys = adapter.columns.filter((c) => c.kind === "decimal").map((c) => c.key);
  const body = rows.slice(1);
  const localeResult = detectNumberLocale(
    body.flatMap((r) => decimalKeys.map((k) => cell(r, k)).filter((v) => v !== "")),
    options.numberLocaleHint,
  );
  if (!localeResult.ok) return failure(localeResult.error.code, localeResult.error.detail, null, warnings);
  const locale = localeResult.locale;
  if (localeResult.ambiguousTokens > 0) {
    warnings.push({ code: "LOCALE_FROM_HINT_OR_EVIDENCE", message: `${localeResult.ambiguousTokens} ambiguous numbers interpreted as ${locale}`, row: null, column: null });
  }
  const orderResult = detectDateOrder(body.map((r) => cell(r, "time")).filter((v) => v !== ""), options.dateOrderHint);
  if (!orderResult.ok) return failure(orderResult.error.code, orderResult.error.detail, null, warnings);

  const parsedRows: TradeRow[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i] ?? [];
    const rowNo = i + 2;
    const tradeNumberRaw = cell(r, "tradeNumber");
    if (!/^\d+$/.test(tradeNumberRaw)) return failure("INVALID_TRADE", `trade number "${tradeNumberRaw}" is not a positive integer`, rowNo, warnings);
    const typeMatch = /^(entry|exit)\s+(long|short)$/i.exec(cell(r, "type"));
    if (!typeMatch) return failure("INVALID_TRADE", `unknown trade row type "${cell(r, "type")}"`, rowNo, warnings);
    const dec = (key: string) => {
      const res = parseDecimal(cell(r, key), locale);
      if (!res.ok) throw new RowError(res.error.code, `${res.error.detail} (column ${key})`, rowNo);
      return res.value;
    };
    try {
      parsedRows.push({
        row: rowNo,
        tradeNumber: Number(tradeNumberRaw),
        side: (typeMatch[1] ?? "").toLowerCase() === "entry" ? "entry" : "exit",
        direction: (typeMatch[2] ?? "").toLowerCase() === "long" ? "LONG" : "SHORT",
        signal: cell(r, "signal") || null,
        timeRaw: cell(r, "time"),
        price: dec("price"),
        quantity: dec("quantity"),
        netPnl: dec("netPnl"),
        netPnlPct: columnIndex.has("netPnlPct") ? dec("netPnlPct") : null,
        cumPnl: columnIndex.has("cumPnl") ? dec("cumPnl") : null,
      });
    } catch (e) {
      if (e instanceof RowError) return failure(e.code, e.message, e.row, warnings);
      throw e;
    }
  }

  const byNumber = new Map<number, TradeRow[]>();
  for (const r of parsedRows) byNumber.set(r.tradeNumber, [...(byNumber.get(r.tradeNumber) ?? []), r]);
  const trades: ParsedTrade[] = [];
  let openExcluded = 0;
  let ambiguousTimes = 0;
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (const n of numbers) {
    const group = byNumber.get(n) ?? [];
    const entries = group.filter((g) => g.side === "entry");
    const exits = group.filter((g) => g.side === "exit");
    const entry = entries[0];
    if (!entry || entries.length > 1 || exits.length > 1) {
      return failure("INVALID_TRADE", `trade ${n} must have exactly one entry row and at most one exit row`, group[0]?.row ?? null, warnings);
    }
    const exit = exits[0];
    if (!exit || exit.timeRaw === "" || /^open$/i.test(exit.signal ?? "")) {
      openExcluded++;
      warnings.push({ code: "OPEN_TRADE_EXCLUDED", message: `trade ${n} is still open and is excluded from closed-trade analysis`, row: entry.row, column: null });
      continue;
    }
    if (entry.direction !== exit.direction) return failure("INVALID_TRADE", `trade ${n} entry and exit directions differ`, exit.row, warnings);
    if (entry.price === null || exit.price === null) return failure("MISSING_REQUIRED_VALUE", `trade ${n} is missing a price`, entry.row, warnings);
    const quantity = entry.quantity ?? exit.quantity;
    if (quantity === null) return failure("MISSING_REQUIRED_VALUE", `trade ${n} is missing a quantity`, entry.row, warnings);
    if (entry.quantity !== null && exit.quantity !== null && !new Decimal(entry.quantity).eq(exit.quantity)) {
      return failure("INVALID_TRADE", `trade ${n} entry and exit quantities differ`, exit.row, warnings);
    }
    const entryTime = parseChartTime(entry.timeRaw, orderResult.order, options.chartTimezone);
    if (!entryTime.ok) return failure(entryTime.error.code, entryTime.error.detail, entry.row, warnings);
    const exitTime = parseChartTime(exit.timeRaw, orderResult.order, options.chartTimezone);
    if (!exitTime.ok) return failure(exitTime.error.code, exitTime.error.detail, exit.row, warnings);
    if (entryTime.value.ambiguous) ambiguousTimes++;
    if (exitTime.value.ambiguous) ambiguousTimes++;
    if (exitTime.value.utc < entryTime.value.utc) return failure("INVALID_TRADE", `trade ${n} exits before it enters`, exit.row, warnings);
    if (entry.netPnl !== null && exit.netPnl !== null && !new Decimal(entry.netPnl).eq(exit.netPnl)) {
      warnings.push({ code: "PNL_ROW_MISMATCH", message: `trade ${n} reports different P&L on entry and exit rows; exit row used`, row: exit.row, column: null });
    }
    trades.push({
      tradeNumber: n,
      direction: entry.direction,
      entryTime: entryTime.value.utc,
      entryPrice: entry.price,
      entrySignal: entry.signal,
      exitTime: exitTime.value.utc,
      exitPrice: exit.price,
      exitSignal: exit.signal,
      quantity,
      reportedNetPnl: exit.netPnl ?? entry.netPnl,
      reportedNetPnlPct: exit.netPnlPct ?? entry.netPnlPct,
      reportedCumulativePnl: exit.cumPnl ?? entry.cumPnl,
      rawRowNumbers: [entry.row, exit.row],
    });
  }
  if (ambiguousTimes > 0) {
    warnings.push({ code: "AMBIGUOUS_LOCAL_TIME", message: `${ambiguousTimes} times fall in a daylight-saving fall-back hour; the earlier instant was used`, row: null, column: null });
  }
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1] ?? 0;
    const cur = numbers[i] ?? 0;
    if (cur !== prev + 1) warnings.push({ code: "TRADE_NUMBER_GAP", message: `trade numbers jump from ${prev} to ${cur}`, row: null, column: null });
  }

  return {
    ok: true,
    report: {
      reportType: "LIST_OF_TRADES",
      parserId: adapter.id,
      parserVersion: adapter.version,
      delimiter,
      numberLocale: locale,
      dateOrder: orderResult.order,
      currency,
      warnings,
      rawRows: rows,
      data: { kind: "LIST_OF_TRADES", trades, openTradesExcluded: openExcluded },
    },
  };
}

class RowError extends Error {
  constructor(
    readonly code: ParseFailureCode,
    message: string,
    readonly row: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Performance Summary
// ---------------------------------------------------------------------------
function parseSummary(
  rows: string[][],
  delimiter: Delimiter,
  adapter: SummaryAdapter,
  options: ParseOptions,
): { ok: true; report: ParsedReport } | { ok: false; error: ParseFailure } {
  const warnings: ParserWarning[] = [];
  const header = (rows[0] ?? []).map((h) => h.trim());
  const valueIdx = header.findIndex((h) => adapter.valueHeader.test(h));
  const pctIdx = header.findIndex((h) => adapter.pctHeader.test(h));
  const currency = adapter.valueHeader.exec(header[valueIdx] ?? "")?.[1];
  if (valueIdx < 0 || !currency) return failure("MISSING_REQUIRED_COLUMN", "summary has no 'All <currency>' column", 1);
  const otherCurrencies = header.flatMap((h) => {
    const m = /^(?:All|Long|Short) ([A-Z]{3,5})$/.exec(h);
    return m?.[1] && m[1] !== currency ? [m[1]] : [];
  });
  if (otherCurrencies.length > 0) return failure("CURRENCY_INCONSISTENT", `summary mixes ${currency} with ${otherCurrencies.join(", ")}`, 1);

  const body = rows.slice(1);
  const tokens = body.flatMap((r) => [r[valueIdx] ?? "", pctIdx >= 0 ? (r[pctIdx] ?? "") : ""]).filter((v) => v.trim() !== "");
  const localeResult = detectNumberLocale(tokens, options.numberLocaleHint);
  if (!localeResult.ok) return failure(localeResult.error.code, localeResult.error.detail);

  const labelToKey = new Map<string, SummaryMetricKey>();
  for (const key of SUMMARY_METRIC_KEYS) for (const label of adapter.labels[key]) labelToKey.set(label, key);

  const metrics: SummaryMetric[] = [];
  const unmappedRows: { label: string; row: number }[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i] ?? [];
    const rowNo = i + 2;
    const label = (r[0] ?? "").trim();
    const key = labelToKey.get(label);
    if (!key) {
      unmappedRows.push({ label, row: rowNo });
      continue;
    }
    if (metrics.some((m) => m.key === key)) return failure("AMBIGUOUS_REPORT_FORMAT", `metric ${key} appears more than once`, rowNo);
    const value = parseDecimal(r[valueIdx] ?? "", localeResult.locale);
    if (!value.ok) return failure(value.error.code, `${value.error.detail} (row "${label}")`, rowNo);
    const pct = pctIdx >= 0 ? parseDecimal(r[pctIdx] ?? "", localeResult.locale) : ({ ok: true, value: null } as const);
    if (!pct.ok) return failure(pct.error.code, `${pct.error.detail} (row "${label}")`, rowNo);
    metrics.push({ key, label, value: value.value, valuePct: pct.value, row: rowNo });
  }
  for (const required of REQUIRED_SUMMARY_KEYS) {
    const m = metrics.find((x) => x.key === required);
    if (!m || (m.value === null && m.valuePct === null)) {
      return failure("MISSING_REQUIRED_VALUE", `summary is missing required metric ${required}`, null, warnings);
    }
  }
  if (unmappedRows.length > 0) {
    warnings.push({
      code: "UNMAPPED_ROWS",
      message: `${unmappedRows.length} rows are not mapped by ${adapter.id}@${adapter.version} and are preserved in raw rows only`,
      row: null,
      column: null,
    });
  }
  return {
    ok: true,
    report: {
      reportType: "PERFORMANCE_SUMMARY",
      parserId: adapter.id,
      parserVersion: adapter.version,
      delimiter,
      numberLocale: localeResult.locale,
      dateOrder: "YMD",
      currency,
      warnings,
      rawRows: rows,
      data: { kind: "PERFORMANCE_SUMMARY", metrics, unmappedRows },
    },
  };
}

export function summaryValue(report: ParsedReport, key: SummaryMetricKey): SummaryMetric | null {
  if (report.data.kind !== "PERFORMANCE_SUMMARY") return null;
  return report.data.metrics.find((m) => m.key === key) ?? null;
}

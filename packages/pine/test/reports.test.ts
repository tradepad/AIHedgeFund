import { describe, expect, it } from "vitest";
import { parseTradingViewReport, summaryValue, type ParseOptions, type ParsedReport } from "../src";
import { classifyNumber, detectNumberLocale, parseChartTime, parseDecimal } from "../src";
import { csv, fixture } from "./helpers";

const utc: ParseOptions = { expectedType: "LIST_OF_TRADES", chartTimezone: "Etc/UTC", numberLocaleHint: null, dateOrderHint: null };
const ny: ParseOptions = { ...utc, chartTimezone: "America/New_York" };

const parse = (bytes: Uint8Array, options: ParseOptions): ParsedReport => {
  const r = parseTradingViewReport(bytes, options);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.detail}`);
  return r.report;
};
const trades = (r: ParsedReport) => (r.data.kind === "LIST_OF_TRADES" ? r.data.trades : []);

describe("list of trades: classic variant", () => {
  const report = parse(fixture("classic-list-of-trades.csv"), utc);

  it("identifies the export and adapter version", () => {
    expect(report).toMatchObject({ reportType: "LIST_OF_TRADES", parserId: "tv-list-of-trades-classic", parserVersion: "1.0.0", delimiter: ",", numberLocale: "DOT_DECIMAL", currency: "USDT" });
  });

  it("pairs entry and exit rows into closed trades regardless of row order", () => {
    const t = trades(report);
    expect(t).toHaveLength(12);
    expect(t[0]).toMatchObject({
      tradeNumber: 1,
      direction: "LONG",
      entryTime: "2024-01-03T14:00:00Z",
      exitTime: "2024-01-05T09:00:00Z",
      entryPrice: "42350.5",
      exitPrice: "43890",
      quantity: "0.0236",
      reportedNetPnl: "35.11",
    });
    expect(t[1]?.direction).toBe("SHORT");
  });

  it("preserves every raw row including the header", () => {
    expect(report.rawRows).toHaveLength(25);
    expect(report.rawRows[0]?.[0]).toBe("Trade #");
  });
});

describe("list of trades: P&L variant (semicolon, comma decimal, New York chart time)", () => {
  const report = parse(fixture("pnl-list-of-trades.csv"), ny);

  it("detects delimiter, locale and day-first dates", () => {
    expect(report).toMatchObject({ parserId: "tv-list-of-trades-pnl", parserVersion: "2.0.0", delimiter: ";", numberLocale: "COMMA_DECIMAL", dateOrder: "DMY" });
  });

  it("produces the same UTC ledger as the classic export, across the DST change", () => {
    const classic = trades(parse(fixture("classic-list-of-trades.csv"), utc));
    const strip = (t: ReturnType<typeof trades>) => t.map(({ rawRowNumbers: _r, reportedCumulativePnl: _c, reportedNetPnlPct: _p, ...rest }) => rest);
    expect(strip(trades(report))).toEqual(strip(classic));
  });
});

describe("performance summary variants", () => {
  it.each([
    ["classic-performance-summary.csv", "tv-performance-summary-classic"],
    ["pnl-performance-summary.csv", "tv-performance-summary-metric"],
  ])("%s maps reported metrics", (file, parserId) => {
    const r = parse(fixture(file), { ...utc, expectedType: "PERFORMANCE_SUMMARY" });
    expect(r.parserId).toBe(parserId);
    expect(summaryValue(r, "net_profit")?.value).toBe("201.09");
    expect(summaryValue(r, "total_closed_trades")?.value).toBe("12");
    expect(summaryValue(r, "gross_loss")?.value).toBe("70.5");
    expect(summaryValue(r, "max_drawdown")?.value).toBe("41.35");
    expect(summaryValue(r, "initial_capital")?.value).toBe("10000");
    expect(r.warnings.map((w) => w.code)).toContain("UNMAPPED_ROWS");
  });
});

describe("rejections instead of guesses", () => {
  const header = "Trade #,Type,Signal,Date/Time,Price USDT,Contracts,Profit USDT";
  const code = (bytes: Uint8Array, options: ParseOptions = utc) => {
    const r = parseTradingViewReport(bytes, options);
    return r.ok ? "OK" : r.error.code;
  };

  it("rejects a report uploaded under the wrong type", () => {
    expect(code(fixture("classic-performance-summary.csv"))).toBe("REPORT_TYPE_MISMATCH");
  });

  it("rejects a missing required column and names it", () => {
    const r = parseTradingViewReport(csv("Trade #,Type,Signal,Date/Time,Price USDT,Contracts\n1,Entry Long,L,2024-01-01 00:00,1,1\n"), utc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("UNKNOWN_REPORT_FORMAT");
      expect(r.error.detail).toContain("Profit");
    }
  });

  it("rejects ambiguous thousands/decimal numbers without a hint, accepts with one", () => {
    const body = `Trade #;Type;Signal;Date/Time;Price USDT;Contracts;Profit USDT\n1;Entry Long;L;2024-01-01 00:00;1.234;1;5\n1;Exit Long;X;2024-01-02 00:00;1.300;1;5\n`;
    expect(code(csv(body))).toBe("AMBIGUOUS_NUMBER_LOCALE");
    const withHint = parse(csv(body), { ...utc, numberLocaleHint: "COMMA_DECIMAL" });
    expect(trades(withHint)[0]?.entryPrice).toBe("1234");
  });

  it("rejects a locale hint that contradicts the file", () => {
    expect(code(fixture("classic-list-of-trades.csv"), { ...utc, numberLocaleHint: "COMMA_DECIMAL" })).toBe("LOCALE_HINT_CONFLICT");
  });

  it("rejects ambiguous day/month order", () => {
    const body = `${header}\n1,Entry Long,L,03/04/2024 10:00,100.5,1,2.5\n1,Exit Long,X,05/04/2024 10:00,103.0,1,2.5\n`;
    expect(code(csv(body))).toBe("AMBIGUOUS_DATE_FORMAT");
    const r = parse(csv(body), { ...utc, dateOrderHint: "DMY" });
    expect(trades(r)[0]?.entryTime).toBe("2024-04-03T10:00:00Z");
  });

  it("rejects ambiguous delimiters", () => {
    expect(code(csv("a,b;c,d\n1,2;3,4\n"))).toBe("AMBIGUOUS_DELIMITER");
  });

  it("rejects invalid UTF-8", () => {
    expect(code(new Uint8Array([0x54, 0xff, 0xfe, 0x00, 0x41]))).toBe("ENCODING_ERROR");
  });

  it("rejects an empty file and a header-only file", () => {
    expect(code(csv(""))).toBe("EMPTY_REPORT");
    expect(code(csv(`${header}\n`))).toBe("EMPTY_REPORT");
  });

  it("rejects trades that exit before entry", () => {
    const body = `${header}\n1,Entry Long,L,2024-01-02 00:00,100,1,1\n1,Exit Long,X,2024-01-01 00:00,101,1,1\n`;
    expect(code(csv(body))).toBe("INVALID_TRADE");
  });

  it("rejects mismatched entry/exit directions and duplicate rows", () => {
    expect(code(csv(`${header}\n1,Entry Long,L,2024-01-01 00:00,100,1,1\n1,Exit Short,X,2024-01-02 00:00,101,1,1\n`))).toBe("INVALID_TRADE");
    expect(code(csv(`${header}\n1,Entry Long,L,2024-01-01 00:00,100,1,1\n1,Entry Long,L,2024-01-01 00:00,100,1,1\n`))).toBe("INVALID_TRADE");
  });

  it("rejects summaries missing required metrics", () => {
    const body = ",All USDT,All %\nGross Profit,10,1\n";
    expect(code(csv(body), { ...utc, expectedType: "PERFORMANCE_SUMMARY" })).toBe("MISSING_REQUIRED_VALUE");
  });

  it("excludes open trades with a warning", () => {
    const body = `${header}\n1,Entry Long,L,2024-01-01 00:00,100,1,1\n1,Exit Long,X,2024-01-02 00:00,101,1,1\n2,Entry Long,L,2024-01-03 00:00,100,1,0\n2,Exit Long,Open,,,1,0\n`;
    const r = parse(csv(body), utc);
    expect(trades(r)).toHaveLength(1);
    expect(r.warnings.map((w) => w.code)).toContain("OPEN_TRADE_EXCLUDED");
  });

  it("reports unknown extra columns without interpreting them", () => {
    const r = parse(csv(`${header},Mystery\n1,Entry Long,L,2024-01-01 00:00,100,1,1,9\n1,Exit Long,X,2024-01-02 00:00,101,1,1,9\n`), utc);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: "UNMAPPED_COLUMN", column: "Mystery" }));
  });

  it("handles quoted fields, BOM and CRLF", () => {
    const body = `\uFEFF${header}\r\n1,Entry Long,"Long, breakout",2024-01-01 00:00,"1,000.50",1,1\r\n1,Exit Long,X,2024-01-02 00:00,"1,010.25",1,1\r\n`;
    const r = parse(csv(body), utc);
    expect(trades(r)[0]).toMatchObject({ entrySignal: "Long, breakout", entryPrice: "1000.5", exitPrice: "1010.25" });
  });
});

describe("number and time primitives", () => {
  it("classifies number tokens", () => {
    expect(classifyNumber("1,234.56")).toBe("DOT");
    expect(classifyNumber("1.234,56")).toBe("COMMA");
    expect(classifyNumber("1,234")).toBe("AMBIGUOUS");
    expect(classifyNumber("12,5")).toBe("COMMA");
    expect(classifyNumber("−12.5")).toBe("DOT");
    expect(classifyNumber("1e5")).toBe("INVALID");
  });

  it("treats integer-only files as unambiguous", () => {
    expect(detectNumberLocale(["1", "20", "-3"], null)).toEqual({ ok: true, locale: "DOT_DECIMAL", ambiguousTokens: 0 });
  });

  it("parses unicode minus, parentheses and grouping into plain decimals", () => {
    expect(parseDecimal("−1,234.50", "DOT_DECIMAL")).toEqual({ ok: true, value: "-1234.5" });
    expect(parseDecimal("(12.00)", "DOT_DECIMAL")).toEqual({ ok: true, value: "-12" });
    expect(parseDecimal("1.234.567,8", "COMMA_DECIMAL")).toEqual({ ok: true, value: "1234567.8" });
    expect(parseDecimal("", "DOT_DECIMAL")).toEqual({ ok: true, value: null });
    expect(parseDecimal("12,34", "DOT_DECIMAL").ok).toBe(false);
  });

  it("converts chart time to UTC across daylight-saving boundaries", () => {
    // New York: EST (UTC-5) before 2024-03-10 02:00, EDT (UTC-4) after.
    expect(parseChartTime("2024-03-09 12:00", "YMD", "America/New_York")).toEqual({ ok: true, value: { utc: "2024-03-09T17:00:00Z", ambiguous: false } });
    expect(parseChartTime("2024-03-11 12:00", "YMD", "America/New_York")).toEqual({ ok: true, value: { utc: "2024-03-11T16:00:00Z", ambiguous: false } });
  });

  it("rejects wall times inside the spring-forward gap", () => {
    const r = parseChartTime("2024-03-10 02:30", "YMD", "America/New_York");
    expect(r.ok).toBe(false);
  });

  it("flags fall-back ambiguity and picks the earlier instant", () => {
    expect(parseChartTime("2024-11-03 01:30", "YMD", "America/New_York")).toEqual({ ok: true, value: { utc: "2024-11-03T05:30:00Z", ambiguous: true } });
  });

  it("never depends on the server timezone", () => {
    expect(parseChartTime("2024-06-01 00:00", "YMD", "Etc/UTC")).toEqual({ ok: true, value: { utc: "2024-06-01T00:00:00Z", ambiguous: false } });
  });
});

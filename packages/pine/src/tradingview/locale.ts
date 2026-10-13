import Decimal from "decimal.js";
import { DateTime } from "luxon";
import type { DateOrder, NumberLocale } from "@arf/contracts";

export type LocaleFailure =
  | { code: "AMBIGUOUS_NUMBER_LOCALE"; detail: string }
  | { code: "LOCALE_HINT_CONFLICT"; detail: string }
  | { code: "AMBIGUOUS_DATE_FORMAT"; detail: string }
  | { code: "INVALID_NUMBER"; detail: string }
  | { code: "INVALID_DATE"; detail: string };

/** Normalise sign characters and whitespace TradingView and spreadsheet tools emit. */
function cleanNumeric(raw: string): string {
  return raw
    .trim()
    .replace(/[\u2212\u2012\u2013]/g, "-")
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
}

type Evidence = "DOT" | "COMMA" | "AMBIGUOUS" | "INTEGER" | "INVALID";

export function classifyNumber(raw: string): Evidence {
  const s = cleanNumeric(raw).replace(/^[+-]/, "");
  if (/^\d+$/.test(s)) return "INTEGER";
  if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^\d{1,3}(,\d{3}){2,}$/.test(s)) return "DOT";
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s)) return "COMMA";
  if (/^\d{1,3}[.,]\d{3}$/.test(s)) return "AMBIGUOUS";
  if (/^\d*\.\d+$/.test(s)) return "DOT";
  if (/^\d*,\d+$/.test(s)) return "COMMA";
  return "INVALID";
}

/**
 * Decide the file's decimal convention from every numeric token. Conflicting
 * evidence, or only ambiguous tokens such as `1,234` without a hint, is
 * rejected rather than guessed.
 */
export function detectNumberLocale(
  tokens: readonly string[],
  hint: NumberLocale | null,
): { ok: true; locale: NumberLocale; ambiguousTokens: number } | { ok: false; error: LocaleFailure } {
  let dot = 0;
  let comma = 0;
  let ambiguous = 0;
  for (const t of tokens) {
    const e = classifyNumber(t);
    if (e === "DOT") dot++;
    else if (e === "COMMA") comma++;
    else if (e === "AMBIGUOUS") ambiguous++;
  }
  if (dot > 0 && comma > 0) {
    return { ok: false, error: { code: "AMBIGUOUS_NUMBER_LOCALE", detail: `file mixes dot-decimal (${dot}) and comma-decimal (${comma}) numbers` } };
  }
  const evidence: NumberLocale | null = dot > 0 ? "DOT_DECIMAL" : comma > 0 ? "COMMA_DECIMAL" : null;
  if (evidence && hint && evidence !== hint) {
    return { ok: false, error: { code: "LOCALE_HINT_CONFLICT", detail: `numbers look ${evidence} but verification declares ${hint}` } };
  }
  if (evidence) return { ok: true, locale: evidence, ambiguousTokens: ambiguous };
  if (ambiguous > 0 && !hint) {
    return {
      ok: false,
      error: { code: "AMBIGUOUS_NUMBER_LOCALE", detail: `${ambiguous} values such as 1,234 could be either convention; declare the number locale on the verification` },
    };
  }
  return { ok: true, locale: hint ?? "DOT_DECIMAL", ambiguousTokens: ambiguous };
}

/** Parse a numeric cell under a known locale into a plain decimal string. Empty cells return null. */
export function parseDecimal(raw: string, locale: NumberLocale): { ok: true; value: string | null } | { ok: false; error: LocaleFailure } {
  const cleaned = cleanNumeric(raw).replace(/%$/, "");
  if (cleaned === "" || cleaned === "-" || /^n\/?a$/i.test(cleaned)) return { ok: true, value: null };
  const [group, decimal] = locale === "DOT_DECIMAL" ? [",", "."] : [".", ","];
  const sign = cleaned.startsWith("-") ? "-" : "";
  const body = cleaned.replace(/^[+-]/, "");
  const groupRe = group === "," ? /^\d{1,3}(,\d{3})+(\.\d+)?$/ : /^\d{1,3}(\.\d{3})+(,\d+)?$/;
  let normalised: string;
  if (groupRe.test(body)) normalised = body.split(group).join("").replace(decimal, ".");
  else if (/^\d*([.,]\d+)?$/.test(body) && !body.includes(group)) normalised = body.replace(decimal, ".");
  else return { ok: false, error: { code: "INVALID_NUMBER", detail: `"${raw}" is not a number in ${locale}` } };
  if (normalised === "" || normalised === ".") return { ok: false, error: { code: "INVALID_NUMBER", detail: `"${raw}" is not a number` } };
  return { ok: true, value: new Decimal(sign + normalised).toFixed() };
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const NUMERIC_RE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Detect day/month order for slash or dot dates; ISO dates need no detection. */
export function detectDateOrder(values: readonly string[], hint: DateOrder | null): { ok: true; order: DateOrder } | { ok: false; error: LocaleFailure } {
  let dmy = false;
  let mdy = false;
  let numeric = 0;
  for (const v of values) {
    const m = NUMERIC_RE.exec(v.trim());
    if (!m) continue;
    numeric++;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (numeric === 0) return { ok: true, order: "YMD" };
  if (dmy && mdy) return { ok: false, error: { code: "AMBIGUOUS_DATE_FORMAT", detail: "dates are inconsistent with both DD/MM and MM/DD" } };
  const evidence: DateOrder | null = dmy ? "DMY" : mdy ? "MDY" : null;
  if (evidence && hint && hint !== "YMD" && hint !== evidence) {
    return { ok: false, error: { code: "LOCALE_HINT_CONFLICT", detail: `dates look ${evidence} but verification declares ${hint}` } };
  }
  if (evidence) return { ok: true, order: evidence };
  if (hint === "DMY" || hint === "MDY") return { ok: true, order: hint };
  return { ok: false, error: { code: "AMBIGUOUS_DATE_FORMAT", detail: "no date has a day above 12, so DD/MM and MM/DD cannot be distinguished; declare the date order" } };
}

export interface ParsedTime {
  utc: string;
  /** Wall-clock time occurs twice (DST fall-back); the earlier instant was chosen. */
  ambiguous: boolean;
}

/**
 * Interpret a wall-clock time in the chart timezone and convert to UTC.
 * Non-existent local times (DST spring-forward gap) are rejected.
 */
export function parseChartTime(raw: string, order: DateOrder, zone: string): { ok: true; value: ParsedTime } | { ok: false; error: LocaleFailure } {
  const s = raw.trim();
  let parts: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
  const iso = ISO_RE.exec(s);
  const g = (m: RegExpExecArray, i: number) => Number(m[i] ?? 0);
  if (iso) {
    parts = { year: g(iso, 1), month: g(iso, 2), day: g(iso, 3), hour: g(iso, 4), minute: g(iso, 5), second: g(iso, 6) };
  } else {
    const n = NUMERIC_RE.exec(s);
    if (n && order !== "YMD") {
      const [a, b] = [g(n, 1), g(n, 2)];
      parts = { year: g(n, 3), month: order === "DMY" ? b : a, day: order === "DMY" ? a : b, hour: g(n, 4), minute: g(n, 5), second: g(n, 6) };
    }
  }
  if (!parts) return { ok: false, error: { code: "INVALID_DATE", detail: `"${raw}" is not a supported date/time` } };
  const dt = DateTime.fromObject(parts, { zone });
  if (!dt.isValid) return { ok: false, error: { code: "INVALID_DATE", detail: `"${raw}" is not valid in ${zone}: ${dt.invalidExplanation ?? ""}` } };
  if (dt.hour !== parts.hour || dt.minute !== parts.minute || dt.day !== parts.day) {
    return { ok: false, error: { code: "INVALID_DATE", detail: `"${raw}" does not exist in ${zone} (daylight-saving gap)` } };
  }
  // Two instants share this wall time if shifting the UTC instant by the DST
  // delta lands on the same local wall time.
  const wall = parts;
  const candidates = [dt.minus({ hours: 1 }), dt, dt.plus({ hours: 1 })].filter(
    (c) => c.hour === wall.hour && c.minute === wall.minute && c.day === wall.day && c.month === wall.month,
  );
  const earliest = candidates.reduce((a, b) => (a.toMillis() <= b.toMillis() ? a : b));
  const utc = earliest.toUTC().toISO({ suppressMilliseconds: true });
  if (!utc) return { ok: false, error: { code: "INVALID_DATE", detail: `"${raw}" could not be converted to UTC` } };
  return { ok: true, value: { utc, ambiguous: candidates.length > 1 } };
}

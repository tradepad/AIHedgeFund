import { z } from "zod";

/** UTC ISO-8601 timestamp with a trailing `Z`. Offsets are rejected at API boundaries. */
export const UtcTimestampSchema = z.iso.datetime({ offset: false });
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;

/** Calendar date (YYYY-MM-DD). */
export const IsoDateSchema = z.iso.date();

/**
 * Authoritative decimal value serialised as a string so binary floating point
 * never touches money. Plain notation only, no exponent, no thousands separator.
 */
export const DecimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/, "must be a plain decimal string such as '1234.50'");
export type DecimalString = z.infer<typeof DecimalStringSchema>;

export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase sha256 hex digest");
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

/** IANA timezone name, e.g. `Etc/UTC`, `America/New_York`. Validated for shape here, existence at service level. */
export const IanaTimezoneSchema = z.string().regex(/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/);

/** TradingView timeframe notation: minutes as digits, or D/W/M with an optional multiplier. */
export const TimeframeSchema = z
  .string()
  .regex(/^(\d+|\d*[DWM]|\d+S)$/, "TradingView timeframe such as 60, 240, 1D");

/** TradingView symbol including exchange prefix, e.g. `BYBIT:BTCUSDT.P`. */
export const TradingViewSymbolSchema = z.string().regex(/^[A-Z0-9_]+:[A-Z0-9._!-]+$/);

export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const CursorSchema = z.string().max(512);

export const PageQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: CursorSchema.nullable(),
  });
}

export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/** RFC 9457-style problem details used by every API error. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  code: z.string(),
  traceId: z.string(),
  errors: z.array(ValidationIssueSchema).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/** Typed result used for expected domain failures (no throwing for policy rejection). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

import { z } from "zod";
import {
  DecimalStringSchema,
  IanaTimezoneSchema,
  IsoDateSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
} from "./common";
import { ReportTypeSchema, ReportUploadStatusSchema, VerificationStatusSchema } from "./enums";

export const NumberLocaleSchema = z.enum(["DOT_DECIMAL", "COMMA_DECIMAL"]);
export type NumberLocale = z.infer<typeof NumberLocaleSchema>;
export const DateOrderSchema = z.enum(["YMD", "DMY", "MDY"]);
export type DateOrder = z.infer<typeof DateOrderSchema>;

/**
 * Settings the operator must reproduce in TradingView. Captured as an
 * immutable snapshot on the verification and hashed.
 */
export const VerificationSettingsSchema = z
  .object({
    symbol: z.string(),
    timeframe: z.string(),
    chartTimezone: IanaTimezoneSchema,
    dateFrom: IsoDateSchema,
    dateTo: IsoDateSchema,
    initialCapital: DecimalStringSchema,
    currency: z.string().regex(/^[A-Z]{3,5}$/),
    commissionType: z.enum(["percent", "cash_per_order", "cash_per_contract"]),
    /** Percentage points per side for `percent`, cash amount otherwise. */
    commissionValue: DecimalStringSchema,
    slippageTicks: z.number().int().min(0),
    defaultQtyType: z.string(),
    defaultQtyValue: DecimalStringSchema,
    marginLongPct: DecimalStringSchema,
    marginShortPct: DecimalStringSchema,
    pyramiding: z.literal(0),
    processOrdersOnClose: z.boolean(),
    calcOnEveryTick: z.boolean(),
    barMagnifier: z.boolean(),
  })
  .strict();
export type VerificationSettings = z.infer<typeof VerificationSettingsSchema>;

export const CreateVerificationRequestSchema = z
  .object({
    strategyVersionId: z.uuid(),
    chartTimezone: IanaTimezoneSchema,
    dateFrom: IsoDateSchema,
    dateTo: IsoDateSchema,
    barMagnifier: z.boolean().default(false),
    numberLocaleHint: NumberLocaleSchema.optional(),
    dateOrderHint: DateOrderSchema.optional(),
  })
  .strict()
  .refine((v) => v.dateFrom < v.dateTo, {
    message: "dateFrom must precede dateTo",
    path: ["dateTo"],
  });
export type CreateVerificationRequest = z.infer<typeof CreateVerificationRequestSchema>;

export const VerificationSchema = z.object({
  id: z.uuid(),
  strategyVersionId: z.uuid(),
  pineRevisionId: z.uuid(),
  pineSourceHash: Sha256HexSchema,
  manifestHash: Sha256HexSchema,
  status: VerificationStatusSchema,
  settings: VerificationSettingsSchema,
  settingsHash: Sha256HexSchema,
  requiredReportTypes: z.array(ReportTypeSchema),
  numberLocaleHint: NumberLocaleSchema.nullable(),
  dateOrderHint: DateOrderSchema.nullable(),
  backtestRunId: z.uuid().nullable(),
  createdBy: z.uuid(),
  createdAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.nullable(),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const MAX_REPORT_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CreateReportUploadRequestSchema = z
  .object({
    reportType: ReportTypeSchema,
    fileName: z
      .string()
      .min(5)
      .max(200)
      .regex(/^[^/\\]+\.csv$/i, "only .csv exports are accepted"),
    contentType: z.enum(["text/csv", "application/vnd.ms-excel", "application/octet-stream"]),
    sizeBytes: z.number().int().positive().max(MAX_REPORT_UPLOAD_BYTES),
    sha256: Sha256HexSchema,
  })
  .strict();
export type CreateReportUploadRequest = z.infer<typeof CreateReportUploadRequestSchema>;

export const PresignedUploadSchema = z.object({
  uploadId: z.uuid(),
  method: z.literal("PUT"),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: UtcTimestampSchema,
});
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;

export const CompleteReportUploadRequestSchema = z
  .object({
    uploadId: z.uuid(),
    /** Operator attestation: the Pine source hash they loaded into TradingView. */
    attestedPineSourceHash: Sha256HexSchema,
    /** Operator attestation that the chart settings matched the verification settings. */
    attestedSettingsMatch: z.literal(true),
  })
  .strict();
export type CompleteReportUploadRequest = z.infer<typeof CompleteReportUploadRequestSchema>;

export const ParserWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  row: z.number().int().nullable(),
  column: z.string().nullable(),
});
export type ParserWarning = z.infer<typeof ParserWarningSchema>;

export const ReportUploadSchema = z.object({
  id: z.uuid(),
  verificationId: z.uuid(),
  reportType: ReportTypeSchema,
  status: ReportUploadStatusSchema,
  fileName: z.string(),
  sizeBytes: z.number().int(),
  declaredSha256: Sha256HexSchema,
  rawArtefactId: z.uuid().nullable(),
  parsedArtefactId: z.uuid().nullable(),
  parserId: z.string().nullable(),
  parserVersion: z.string().nullable(),
  warnings: z.array(ParserWarningSchema),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  uploadedBy: z.uuid(),
  createdAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.nullable(),
});
export type ReportUpload = z.infer<typeof ReportUploadSchema>;

export const VerificationStatusViewSchema = z.object({
  verification: VerificationSchema,
  uploads: z.array(ReportUploadSchema),
  jobs: z.array(
    z.object({
      jobKey: z.string(),
      jobName: z.string(),
      status: z.string(),
      attempts: z.number().int(),
      lastErrorCode: z.string().nullable(),
      updatedAt: UtcTimestampSchema,
    }),
  ),
});
export type VerificationStatusView = z.infer<typeof VerificationStatusViewSchema>;

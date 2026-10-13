import { z } from "zod";
import { UtcTimestampSchema } from "./common";
import { ParityStatusSchema } from "./enums";

export const ParityCheckSchema = z.object({
  check: z.enum([
    "SOURCE_IDENTITY",
    "SETTINGS_IDENTITY",
    "TRADE_COUNT",
    "NET_PROFIT",
    "MAX_DRAWDOWN",
    "FIRST_TRADE",
    "LAST_TRADE",
    "TRADE_PNL_SEQUENCE",
    "DATE_RANGE",
  ]),
  status: ParityStatusSchema,
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  tolerance: z.string().nullable(),
  detail: z.string(),
});
export type ParityCheck = z.infer<typeof ParityCheckSchema>;

export const ParityReportSchema = z.object({
  id: z.uuid(),
  verificationId: z.uuid(),
  backtestRunId: z.uuid(),
  policyVersion: z.string(),
  status: ParityStatusSchema,
  checks: z.array(ParityCheckSchema),
  firstDivergence: ParityCheckSchema.nullable(),
  createdAt: UtcTimestampSchema,
});
export type ParityReport = z.infer<typeof ParityReportSchema>;

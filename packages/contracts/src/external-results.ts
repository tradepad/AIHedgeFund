import { z } from "zod";
import {
  DecimalStringSchema,
  IsoDateSchema,
  Sha256HexSchema,
  TimeframeSchema,
  TradingViewSymbolSchema,
  UtcTimestampSchema,
} from "./common";
import { ChangeCategorySchema } from "./enums";

/**
 * External strategy import (version 1.0.0).
 *
 * Research done outside ARF-OS (trader-dev backtests, offline scripts, results
 * reported by a library author) enters the registry as *external evidence*.
 * It creates campaigns, strategies and immutable versions, but its numbers are
 * never ARF-calculated metrics, never TradingView-verified, and never move a
 * version through the workflow. They are stored and shown under an explicit
 * "external" label so they cannot be mistaken for verified results.
 *
 * Backward compatibility: new optional fields may be added in 1.x; changing a
 * field's meaning or removing one requires 2.0.0.
 */
export const EXTERNAL_IMPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Where the numbers were produced. */
export const ExternalEngineSchema = z.enum(["TRADER_DEV", "OFFLINE_SCRIPT"]);
export type ExternalEngine = z.infer<typeof ExternalEngineSchema>;

/** Who produced the numbers: our own run, or the strategy's author (unverified). */
export const ExternalProvenanceSchema = z.enum(["OUR_RUN", "AUTHOR_REPORTED"]);
export type ExternalProvenance = z.infer<typeof ExternalProvenanceSchema>;

/** Which data the run covered, as the external study defined it. */
export const ExternalSegmentSchema = z.enum([
  "IN_SAMPLE",
  "HOLDOUT",
  "OUT_OF_SAMPLE",
  "FULL_HISTORY",
  "SUB_PERIOD",
  "AUTHOR_WINDOW",
]);
export type ExternalSegment = z.infer<typeof ExternalSegmentSchema>;

export const ExternalRunStatusSchema = z.enum(["COMPLETED", "NOT_RUN"]);
export type ExternalRunStatus = z.infer<typeof ExternalRunStatusSchema>;

/** The external study's own gate verdict. Evidence, not an ARF decision. */
export const ExternalVerdictSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE", "NOT_EVALUATED"]);
export type ExternalVerdict = z.infer<typeof ExternalVerdictSchema>;

export const ExternalSourceLanguageSchema = z.enum(["PINE", "PYTHON"]);
export type ExternalSourceLanguage = z.infer<typeof ExternalSourceLanguageSchema>;

const ImportKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._/-]{2,199}$/, "lowercase key such as pilot-2026-10-13/p04/is");

/**
 * Headline numbers as the external engine reported them. Percentages are in
 * percent points (`"28.2"` means 28.2 %). Money is in `currency`. A null value
 * means the source did not report it; it is never a silent zero.
 */
export const ExternalMetricsSchema = z
  .object({
    closedTradeCount: z.number().int().nonnegative().nullable(),
    profitFactor: DecimalStringSchema.nullable(),
    maxDrawdownPct: DecimalStringSchema.nullable(),
    netProfitPct: DecimalStringSchema.nullable(),
    netProfit: DecimalStringSchema.nullable(),
    largestWin: DecimalStringSchema.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3,5}$/)
      .nullable(),
  })
  .strict();
export type ExternalMetrics = z.infer<typeof ExternalMetricsSchema>;

/** Additional named values (e.g. `cagr_pct`, `sharpe`). Keys carry their unit. */
export const ExternalExtraMetricsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  DecimalStringSchema,
);

/** Settings the external run used, recorded verbatim for reproducibility. */
export const ExternalSettingsSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  z.union([z.string().max(500), z.number(), z.boolean()]),
);

export const ExternalResultInputSchema = z
  .object({
    key: ImportKeySchema,
    engine: ExternalEngineSchema,
    engineVersion: z.string().min(1).max(100).nullable(),
    provenance: ExternalProvenanceSchema,
    segment: ExternalSegmentSchema,
    runStatus: ExternalRunStatusSchema,
    windowFrom: IsoDateSchema.nullable(),
    windowTo: IsoDateSchema.nullable(),
    externalResultId: z.string().min(1).max(100).nullable(),
    metrics: ExternalMetricsSchema,
    extraMetrics: ExternalExtraMetricsSchema,
    settings: ExternalSettingsSchema,
    verdict: ExternalVerdictSchema,
    verdictReasons: z.array(z.string().min(1).max(300)).max(20),
    notes: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.windowFrom && r.windowTo && r.windowFrom > r.windowTo)
      ctx.addIssue({ code: "custom", path: ["windowTo"], message: "window ends before it starts" });
    if (r.runStatus === "NOT_RUN") {
      if (Object.values(r.metrics).some((v) => v !== null))
        ctx.addIssue({
          code: "custom",
          path: ["metrics"],
          message: "a NOT_RUN result cannot carry metrics",
        });
      if (r.notes.length === 0)
        ctx.addIssue({ code: "custom", path: ["notes"], message: "say why it did not run" });
    }
  });
export type ExternalResultInput = z.infer<typeof ExternalResultInputSchema>;

export const ExternalSourceInputSchema = z
  .object({
    language: ExternalSourceLanguageSchema,
    code: z.string().min(1).max(200_000),
  })
  .strict();
export type ExternalSourceInput = z.infer<typeof ExternalSourceInputSchema>;

export const ExternalVersionInputSchema = z
  .object({
    key: ImportKeySchema,
    symbol: TradingViewSymbolSchema,
    timeframe: TimeframeSchema,
    description: z.string().trim().min(3).max(1000),
    /** Required for every version after the first: what changed versus the previous one. */
    change: z
      .object({
        categories: z.array(ChangeCategorySchema).min(1),
        fields: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .nullable(),
    externalStrategyId: z.string().min(1).max(100).nullable(),
    source: ExternalSourceInputSchema.nullable(),
    results: z.array(ExternalResultInputSchema).min(1).max(50),
  })
  .strict();
export type ExternalVersionInput = z.infer<typeof ExternalVersionInputSchema>;

export const ExternalStrategyInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    family: z.string().regex(/^[a-z][a-z0-9_]*$/),
    versions: z.array(ExternalVersionInputSchema).min(1).max(20),
  })
  .strict()
  .superRefine((s, ctx) => {
    s.versions.forEach((v, i) => {
      if (i === 0 && v.change !== null)
        ctx.addIssue({
          code: "custom",
          path: ["versions", i, "change"],
          message: "the first version is a root version and has no change",
        });
      if (i > 0 && v.change === null)
        ctx.addIssue({
          code: "custom",
          path: ["versions", i, "change"],
          message: "later versions must state what changed",
        });
    });
  });
export type ExternalStrategyInput = z.infer<typeof ExternalStrategyInputSchema>;

export const ExternalCampaignInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    objective: z.string().trim().min(10).max(2000),
    assetClasses: z
      .array(z.enum(["crypto", "equity", "fx", "futures", "index", "commodity"]))
      .min(1),
    timeframes: z.array(z.string().regex(/^(\d+|\d*[DWM])$/)).min(1),
    strategies: z.array(ExternalStrategyInputSchema).min(1).max(500),
  })
  .strict();
export type ExternalCampaignInput = z.infer<typeof ExternalCampaignInputSchema>;

export const ExternalImportBundleSchema = z
  .object({
    schemaVersion: z.literal(EXTERNAL_IMPORT_SCHEMA_VERSION),
    batchId: ImportKeySchema,
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(10).max(4000),
    campaigns: z.array(ExternalCampaignInputSchema).min(1).max(50),
  })
  .strict()
  .superRefine((b, ctx) => {
    const seen = new Set<string>();
    const names = new Set<string>();
    const dup = (key: string, path: (string | number)[]) => {
      if (seen.has(key))
        ctx.addIssue({ code: "custom", path, message: `duplicate import key ${key}` });
      seen.add(key);
    };
    b.campaigns.forEach((c, ci) =>
      c.strategies.forEach((s, si) => {
        if (names.has(s.name))
          ctx.addIssue({
            code: "custom",
            path: ["campaigns", ci, "strategies", si, "name"],
            message: `duplicate strategy name ${s.name}`,
          });
        names.add(s.name);
        s.versions.forEach((v, vi) => {
          const vp = ["campaigns", ci, "strategies", si, "versions", vi];
          dup(v.key, [...vp, "key"]);
          v.results.forEach((r, ri) => dup(r.key, [...vp, "results", ri, "key"]));
        });
      }),
    );
  });
export type ExternalImportBundle = z.infer<typeof ExternalImportBundleSchema>;

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export const ExternalResultSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  engine: ExternalEngineSchema,
  engineVersion: z.string().nullable(),
  provenance: ExternalProvenanceSchema,
  segment: ExternalSegmentSchema,
  runStatus: ExternalRunStatusSchema,
  windowFrom: IsoDateSchema.nullable(),
  windowTo: IsoDateSchema.nullable(),
  externalResultId: z.string().nullable(),
  metrics: ExternalMetricsSchema,
  extraMetrics: z.record(z.string(), DecimalStringSchema),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  verdict: ExternalVerdictSchema,
  verdictReasons: z.array(z.string()),
  notes: z.array(z.string()),
  importedAt: UtcTimestampSchema,
});
export type ExternalResult = z.infer<typeof ExternalResultSchema>;

export const ExternalEvidenceViewSchema = z.object({
  import: z
    .object({
      id: z.uuid(),
      batchId: z.string(),
      batchTitle: z.string(),
      key: z.string(),
      externalStrategyId: z.string().nullable(),
      source: z
        .object({
          language: ExternalSourceLanguageSchema,
          sha256: Sha256HexSchema,
          code: z.string(),
        })
        .nullable(),
      importedBy: z.uuid(),
      importedAt: UtcTimestampSchema,
    })
    .nullable(),
  results: z.array(ExternalResultSchema),
});
export type ExternalEvidenceView = z.infer<typeof ExternalEvidenceViewSchema>;

/** Summary returned by an import run. */
export const ExternalImportSummarySchema = z.object({
  batchId: z.string(),
  bundleSha256: Sha256HexSchema,
  campaigns: z.object({ created: z.number().int(), reused: z.number().int() }),
  strategies: z.object({ created: z.number().int(), reused: z.number().int() }),
  versions: z.object({ created: z.number().int(), reused: z.number().int() }),
  results: z.object({ created: z.number().int(), reused: z.number().int() }),
  versionIds: z.array(z.uuid()),
});
export type ExternalImportSummary = z.infer<typeof ExternalImportSummarySchema>;

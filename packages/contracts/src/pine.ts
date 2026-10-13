import { z } from "zod";
import { Sha256HexSchema, SemverSchema, TimeframeSchema, TradingViewSymbolSchema } from "./common";
import { LintStatusSchema } from "./enums";

/**
 * Pine manifest: the declared execution identity of a Pine Script v6 revision.
 * The static checker verifies the source declares exactly these properties.
 * Version 1.0.0.
 */
export const PINE_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

export const PineInputSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    type: z.enum(["int", "float", "bool"]),
    default: z.union([z.number(), z.boolean()]),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
  })
  .strict();
export type PineInput = z.infer<typeof PineInputSchema>;

export const PineManifestSchema = z
  .object({
    schemaVersion: SemverSchema.refine((v) => v === PINE_MANIFEST_SCHEMA_VERSION),
    pineVersion: z.literal(6),
    strategyId: z.uuid(),
    strategyVersionId: z.uuid(),
    campaignId: z.uuid(),
    parentVersionId: z.uuid().nullable(),
    sdlHash: Sha256HexSchema,
    title: z.string().min(1).max(120),
    symbol: TradingViewSymbolSchema,
    timeframe: TimeframeSchema,
    properties: z
      .object({
        initialCapital: z.number().positive(),
        currency: z.string().regex(/^[A-Z]{3,5}$/),
        defaultQtyType: z.enum(["strategy.percent_of_equity", "strategy.fixed", "strategy.cash"]),
        defaultQtyValue: z.number().positive(),
        commissionType: z.enum([
          "strategy.commission.percent",
          "strategy.commission.cash_per_order",
          "strategy.commission.cash_per_contract",
        ]),
        commissionValue: z.number().min(0),
        slippageTicks: z.number().int().min(0),
        pyramiding: z.literal(0),
        marginLongPct: z.number().positive().max(100),
        marginShortPct: z.number().positive().max(100),
        processOrdersOnClose: z.boolean(),
        calcOnEveryTick: z.boolean(),
        calcOnOrderFills: z.boolean(),
      })
      .strict(),
    inputs: z.array(PineInputSchema),
    dateWindow: z
      .object({ startInputKey: z.string().min(1), endInputKey: z.string().min(1) })
      .strict(),
    alertSchema: z.literal("arf.signal.v1"),
  })
  .strict();
export type PineManifest = z.infer<typeof PineManifestSchema>;

export const PineLintFindingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["ERROR", "WARNING"]),
  message: z.string(),
  line: z.number().int().positive().nullable(),
});
export type PineLintFinding = z.infer<typeof PineLintFindingSchema>;

export const PineLintResultSchema = z.object({
  linterVersion: SemverSchema,
  status: LintStatusSchema,
  findings: z.array(PineLintFindingSchema),
});
export type PineLintResult = z.infer<typeof PineLintResultSchema>;

import { z } from "zod";
import { IanaTimezoneSchema, SemverSchema, TimeframeSchema, TradingViewSymbolSchema } from "./common";

/**
 * Strategy Definition Language (spec §9). Contract between Strategy Architect
 * and Pine Engineer. Version 1.0.0. Any change to an SDL document creates a new
 * strategy version.
 *
 * Units:
 * - `risk.sizePercent` is percentage points of equity (10 = 10%).
 * - `costs.commissionValue` with `commissionType: "percent"` is percentage
 *   points of order notional per side (0.06 = 0.06%), matching TradingView.
 */
export const SDL_SCHEMA_VERSION = "1.0.0" as const;

const ParameterKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const ParameterRefSchema = z.object({ parameter: ParameterKeySchema }).strict();

/**
 * Approved expression grammar: conditions combined with AND / OR / NOT and
 * parentheses. Condition names are snake_case identifiers declared by signals.
 * No arithmetic or executable code is permitted.
 */
export const SdlExpressionSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^(\(|\)|\s|AND|OR|NOT|[a-z][a-z0-9_]*)+$/,
    "expression may only contain snake_case condition names, AND, OR, NOT and parentheses",
  );

const NumericParameterSchema = z
  .object({
    key: ParameterKeySchema,
    type: z.enum(["int", "float"]),
    default: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    description: z.string().max(500).optional(),
  })
  .strict()
  .refine((p) => p.min <= p.default && p.default <= p.max, {
    message: "default must lie within [min, max]",
  })
  .refine((p) => p.type !== "int" || [p.default, p.min, p.max, p.step].every(Number.isInteger), {
    message: "int parameters require integer default, min, max and step",
  });

const BoolParameterSchema = z
  .object({
    key: ParameterKeySchema,
    type: z.literal("bool"),
    default: z.boolean(),
    description: z.string().max(500).optional(),
  })
  .strict();

export const SdlParameterSchema = z.union([NumericParameterSchema, BoolParameterSchema]);
export type SdlParameter = z.infer<typeof SdlParameterSchema>;

const SignalSchema = z
  .object({
    type: z.string().regex(/^[a-z][a-z0-9_]*$/),
  })
  .catchall(z.union([z.number(), z.string(), z.boolean(), ParameterRefSchema]));

const StopSchema = z
  .object({
    type: z.enum(["atr_multiple", "percent", "fixed_ticks", "risk_multiple"]),
    value: z.number().positive().optional(),
    valueParameter: ParameterKeySchema.optional(),
  })
  .strict()
  .refine((s) => (s.value === undefined) !== (s.valueParameter === undefined), {
    message: "exactly one of value or valueParameter is required",
  });

export const StrategyDefinitionSchema = z
  .object({
    schemaVersion: SemverSchema.refine((v) => v === SDL_SCHEMA_VERSION, {
      message: `schemaVersion must be ${SDL_SCHEMA_VERSION}`,
    }),
    strategy: z
      .object({
        name: z.string().min(3).max(120),
        family: z.string().regex(/^[a-z][a-z0-9_]*$/),
        thesis: z.string().min(10).max(1000),
        directions: z.array(z.enum(["long", "short"])).min(1),
      })
      .strict(),
    market: z
      .object({
        assetClass: z.enum(["crypto", "equity", "fx", "futures", "index", "commodity"]),
        symbols: z.array(TradingViewSymbolSchema).min(1),
        timeframe: TimeframeSchema,
        timezone: IanaTimezoneSchema,
        session: z.string().regex(/^\d{4}-\d{4}(:[1-7]+)?$/),
        chartType: z.literal("standard_ohlc"),
      })
      .strict(),
    signals: z
      .object({
        longEntry: SdlExpressionSchema.optional(),
        shortEntry: SdlExpressionSchema.optional(),
        longExit: SdlExpressionSchema.optional(),
        shortExit: SdlExpressionSchema.optional(),
      })
      .catchall(z.union([SignalSchema, SdlExpressionSchema])),
    execution: z
      .object({
        entryOrder: z.enum(["market_next_bar", "limit", "stop"]),
        pyramiding: z.number().int().min(0).max(0, "pyramiding must be 0 in this release"),
        allowReversal: z.boolean(),
        processOnClose: z.boolean(),
        calcOnEveryTick: z.boolean(),
      })
      .strict(),
    risk: z
      .object({
        sizingModel: z.enum(["percent_of_equity", "fixed_quantity", "fixed_cash"]),
        sizePercent: z.number().positive().max(100).optional(),
        fixedQuantity: z.number().positive().optional(),
        fixedCash: z.number().positive().optional(),
        leverage: z.number().min(1).max(100),
        stopLoss: StopSchema,
        takeProfit: StopSchema,
        oneStopOneTarget: z.literal(true),
      })
      .strict(),
    costs: z
      .object({
        commissionType: z.enum(["percent", "cash_per_order", "cash_per_contract"]),
        commissionValue: z.number().min(0),
        slippageTicks: z.number().int().min(0),
      })
      .strict(),
    parameters: z.array(SdlParameterSchema),
    segments: z
      .object({
        warmupBars: z.number().int().min(0),
        selectionMode: z.enum(["fixed", "rolling_walk_forward", "anchored_walk_forward", "regime"]),
        embargoBars: z.number().int().min(0),
      })
      .strict(),
    falsification: z.array(z.string().min(5)).min(1),
  })
  .strict()
  .superRefine((sdl, ctx) => {
    const keys = sdl.parameters.map((p) => p.key);
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["parameters"], message: `duplicate parameter ${key}` });
      seen.add(key);
    }
    const referenced = collectParameterRefs(sdl);
    for (const ref of referenced) {
      if (!seen.has(ref.key)) {
        ctx.addIssue({ code: "custom", path: ref.path, message: `undeclared parameter ${ref.key}` });
      }
    }
    if (sdl.risk.sizingModel === "percent_of_equity" && sdl.risk.sizePercent === undefined) {
      ctx.addIssue({ code: "custom", path: ["risk", "sizePercent"], message: "required for percent_of_equity" });
    }
    if (sdl.strategy.directions.includes("long") && !sdl.signals.longEntry) {
      ctx.addIssue({ code: "custom", path: ["signals", "longEntry"], message: "required when long direction enabled" });
    }
    if (sdl.strategy.directions.includes("short") && !sdl.signals.shortEntry) {
      ctx.addIssue({ code: "custom", path: ["signals", "shortEntry"], message: "required when short direction enabled" });
    }
  });
export type StrategyDefinition = z.infer<typeof StrategyDefinitionSchema>;

function collectParameterRefs(value: unknown, path: (string | number)[] = []): { key: string; path: (string | number)[] }[] {
  if (value === null || typeof value !== "object") return [];
  const out: { key: string; path: (string | number)[] }[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === "parameters" && path.length === 0) continue;
    if ((k === "parameter" || k === "valueParameter") && typeof v === "string") {
      out.push({ key: v, path: [...path, k] });
    } else {
      out.push(...collectParameterRefs(v, [...path, k]));
    }
  }
  return out;
}

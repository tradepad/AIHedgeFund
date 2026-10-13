import { z } from "zod";
import { TimeframeSchema, TradingViewSymbolSchema } from "./common";

/**
 * Forward-test alert payload (spec §11.10). Contract only in this milestone;
 * no webhook or paper engine consumes it yet. The webhook must validate every
 * field against the deployment manifest rather than trusting it.
 */
export const SignalEventSchema = z
  .object({
    schema: z.literal("arf.signal.v1"),
    deploymentId: z.uuid(),
    strategyVersionId: z.uuid(),
    eventId: z.string().min(8).max(128),
    eventType: z.enum([
      "ENTRY_LONG",
      "ENTRY_SHORT",
      "EXIT_LONG",
      "EXIT_SHORT",
      "STOP_HIT",
      "TARGET_HIT",
      "HEARTBEAT",
    ]),
    orderId: z.string().min(1).max(64),
    symbol: TradingViewSymbolSchema,
    timeframe: TimeframeSchema,
    barTime: z.iso.datetime({ offset: false }),
    sentAt: z.iso.datetime({ offset: false }),
    price: z.number().positive(),
    quantityModel: z.enum(["percent_of_equity", "fixed_quantity", "fixed_cash"]),
    stopPrice: z.number().positive().optional(),
    targetPrice: z.number().positive().optional(),
  })
  .strict();
export type SignalEvent = z.infer<typeof SignalEventSchema>;

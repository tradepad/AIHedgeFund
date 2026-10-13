import { z } from "zod";

export const IdParams = z.object({ id: z.uuid() });
export const PageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Per-route limits for expensive or sensitive commands (spec §17.1). */
export function commandRateLimit(max: number) {
  return { rateLimit: { max, timeWindow: "1 minute" } };
}

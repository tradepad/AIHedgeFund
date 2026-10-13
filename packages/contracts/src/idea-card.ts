import { z } from "zod";
import { SemverSchema, TimeframeSchema } from "./common";

/** Idea Card produced by the IDEA_SCOUT lane (spec §7.2). Version 1.0.0. */
export const IDEA_CARD_SCHEMA_VERSION = "1.0.0" as const;

export const IdeaRecommendationSchema = z.enum(["RESEARCH", "PARK", "REJECT"]);

export const IdeaCardSchema = z
  .object({
    schemaVersion: SemverSchema.refine((v) => v === IDEA_CARD_SCHEMA_VERSION),
    title: z.string().min(3).max(160),
    hypothesis: z.string().min(10).max(400),
    sourceSummary: z.string().min(1).max(2000),
    sources: z
      .array(
        z
          .object({
            url: z.url(),
            licence: z.string().min(1).max(120),
            retrievedAt: z.iso.datetime({ offset: false }),
          })
          .strict(),
      )
      .max(20),
    marketMechanism: z.string().min(10).max(1000),
    expectedDirection: z.enum(["long", "short", "both"]),
    targetAssets: z.array(z.string().min(1)).min(1),
    targetTimeframes: z.array(TimeframeSchema).min(1),
    expectedRegime: z.string().min(1).max(500),
    failureRegime: z.string().min(1).max(500),
    requiredInputs: z.array(z.string().min(1)).min(1),
    pineFeasibility: z.enum(["HIGH", "MEDIUM", "LOW", "INFEASIBLE"]),
    expectedTradeFrequency: z.enum(["INTRADAY", "DAILY", "WEEKLY", "MONTHLY", "RARE"]),
    cheapestFalsificationTest: z.string().min(10).max(1000),
    noveltyScore: z.number().min(0).max(1),
    evidenceStrength: z.enum(["STRONG", "MODERATE", "WEAK", "ANECDOTAL"]),
    similarInternalStrategies: z.array(z.uuid()),
    risks: z.array(z.string().min(1)).min(1),
    recommendation: IdeaRecommendationSchema,
    summary: z
      .string()
      .min(1)
      .max(600)
      .describe("Human-readable explanatory summary. Structured fields are canonical."),
  })
  .strict();
export type IdeaCard = z.infer<typeof IdeaCardSchema>;

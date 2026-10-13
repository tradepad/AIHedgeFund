import { createHash } from "node:crypto";
import { exampleIdeaCard, type IdeaCard } from "@arf/contracts";
import type {
  ModelProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "./provider";

/**
 * Deterministic development provider. Returns a fixed, schema-valid Idea Card
 * derived from the input objective so tests and local development need no
 * model credentials. It never claims evidence: every card is ANECDOTAL.
 * `mode: "invalid-then-valid"` and `"always-invalid"` exercise the repair path.
 */
export class FixtureModelProvider implements ModelProvider {
  readonly name = "fixture";

  constructor(private readonly mode: "valid" | "invalid-then-valid" | "always-invalid" = "valid") {}

  generateStructured<TInput, TOutput>(
    request: StructuredGenerationRequest<TInput, TOutput>,
  ): Promise<StructuredGenerationResult> {
    const isRepair = (request.repair?.length ?? 0) > 0;
    const objective =
      typeof request.input === "object" && request.input !== null && "objective" in request.input
        ? String((request.input as { objective: unknown }).objective)
        : "";
    const digest = createHash("sha256").update(objective).digest("hex").slice(0, 8);
    const card: IdeaCard = {
      ...exampleIdeaCard,
      title: `${exampleIdeaCard.title} [${digest}]`,
      summary: `Fixture idea for objective "${objective.slice(0, 120)}". Development fixture, not research evidence.`,
    };
    const invalid =
      this.mode === "always-invalid" || (this.mode === "invalid-then-valid" && !isRepair);
    const rawText = invalid
      ? JSON.stringify({ ...card, recommendation: "BUY_NOW", noveltyScore: 7 })
      : JSON.stringify(card);
    return Promise.resolve({
      rawText,
      provider: this.name,
      model: "fixture-idea-scout-v1",
      inputTokens: Math.ceil(request.systemPrompt.length / 4),
      outputTokens: Math.ceil(rawText.length / 4),
      costUsd: "0",
    });
  }
}

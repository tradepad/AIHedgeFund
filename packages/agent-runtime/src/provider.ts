import type { z } from "zod";
import type { AgentRole } from "@arf/contracts";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredGenerationRequest<TInput, TOutput> {
  role: AgentRole;
  systemPrompt: string;
  input: TInput;
  outputSchema: z.ZodType<TOutput>;
  /** Messages for a repair attempt (previous output and exact validation errors). */
  repair?: ProviderMessage[];
}

export interface StructuredGenerationResult {
  /** Raw text returned by the provider. Stored only in protected diagnostics. */
  rawText: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Cost in USD as a decimal string. */
  costUsd: string;
}

/**
 * Provider adapters translate a request into a model call and return raw
 * text. They contain no research workflow logic: parsing, validation, retry
 * and persistence belong to the role runner and the caller.
 */
export interface ModelProvider {
  readonly name: string;
  generateStructured<TInput, TOutput>(
    request: StructuredGenerationRequest<TInput, TOutput>,
  ): Promise<StructuredGenerationResult>;
}

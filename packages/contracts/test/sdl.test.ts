import { describe, expect, it } from "vitest";
import {
  StrategyDefinitionSchema,
  exampleStrategyDefinition,
  type StrategyDefinition,
} from "../src";

const clone = (): StrategyDefinition => structuredClone(exampleStrategyDefinition);

describe("StrategyDefinitionSchema", () => {
  it("accepts the specification example", () => {
    expect(StrategyDefinitionSchema.parse(exampleStrategyDefinition)).toEqual(
      exampleStrategyDefinition,
    );
  });

  it("rejects references to undeclared parameters", () => {
    const sdl = clone();
    sdl.risk.stopLoss = { type: "atr_multiple", valueParameter: "missing_param" };
    const r = StrategyDefinitionSchema.safeParse(sdl);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("undeclared parameter missing_param");
  });

  it("rejects pyramiding other than zero", () => {
    const sdl = clone();
    sdl.execution.pyramiding = 2;
    expect(StrategyDefinitionSchema.safeParse(sdl).success).toBe(false);
  });

  it("rejects executable logic in expressions", () => {
    const sdl = clone();
    sdl.signals.longEntry = "close > open; strategy.entry()";
    expect(StrategyDefinitionSchema.safeParse(sdl).success).toBe(false);
  });

  it("rejects a parameter default outside its range", () => {
    const sdl = clone();
    sdl.parameters[0] = { key: "fast_length", type: "int", default: 5, min: 10, max: 50, step: 5 };
    expect(StrategyDefinitionSchema.safeParse(sdl).success).toBe(false);
  });

  it("rejects unknown top-level fields instead of ignoring them", () => {
    const r = StrategyDefinitionSchema.safeParse({ ...clone(), extra: true });
    expect(r.success).toBe(false);
  });

  it("requires an entry expression for each enabled direction", () => {
    const sdl = clone();
    delete sdl.signals.shortEntry;
    expect(StrategyDefinitionSchema.safeParse(sdl).success).toBe(false);
  });

  it("does not coerce numeric strings", () => {
    const sdl = clone() as unknown as { costs: { commissionValue: unknown } };
    sdl.costs.commissionValue = "0.06";
    expect(StrategyDefinitionSchema.safeParse(sdl).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { uuidv7, uuidv7Timestamp, StrategyVersionIdSchema } from "../src";

describe("uuidv7", () => {
  it("produces RFC 9562 version 7 identifiers", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(StrategyVersionIdSchema.safeParse(id).success).toBe(true);
  });

  it("encodes the millisecond timestamp so ids sort by creation time", () => {
    const t = Date.UTC(2026, 9, 13, 7, 0, 0);
    expect(uuidv7Timestamp(uuidv7(t))).toBe(t);
    const a = uuidv7(t);
    const b = uuidv7(t + 1);
    expect(a < b).toBe(true);
  });

  it("does not collide across many draws", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });
});

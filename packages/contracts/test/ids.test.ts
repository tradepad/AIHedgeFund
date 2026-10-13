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

import { canonicalJson } from "../src";
import { hashCanonical, sha256Hex } from "../src/node";

describe("canonical hashing", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: "z" } })).toBe(
      '{"a":{"c":"z","d":[3,{"x":2,"y":1}]},"b":1}',
    );
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it("rejects non-finite numbers rather than serialising null", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });

  it("hashes known vectors", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

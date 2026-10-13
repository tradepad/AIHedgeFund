import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, traceIdFromHeader, withSpan } from "../src";

describe("observability", () => {
  it("accepts a valid traceparent and rejects malformed ones", () => {
    const id = "4bf92f3577b34da6a3ce929d0e0e4736";
    expect(traceIdFromHeader(`00-${id}-00f067aa0ba902b7-01`)).toBe(id);
    expect(traceIdFromHeader("garbage")).toMatch(/^[0-9a-f]{32}$/);
    expect(traceIdFromHeader(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`)).not.toBe("0".repeat(32));
  });

  it("redacts secrets from structured logs", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger("test", { destination: sink });
    logger.info(
      { headers: { authorization: "Bearer abc" }, auth: { token: "xyz" }, password: "pw1" },
      "hello",
    );
    expect(lines.join("")).toContain("[REDACTED]");
    expect(lines.join("")).not.toContain("pw1");
    expect(lines.join("")).not.toContain("abc");
    expect(lines.join("")).not.toContain("xyz");
  });

  it("propagates results and errors through spans", async () => {
    await expect(withSpan("ok", {}, () => Promise.resolve(42))).resolves.toBe(42);
    await expect(withSpan("fail", {}, () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
  });
});

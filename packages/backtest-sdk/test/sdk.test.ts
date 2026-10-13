import { describe, expect, it } from "vitest";
import { UnavailableLocalRunner } from "../src";

describe("local runner placeholder", () => {
  it("declares itself unavailable and refuses to run", async () => {
    const runner = new UnavailableLocalRunner();
    expect(runner.capabilities()).toMatchObject({ runner: "LOCAL_RUNNER", available: false });
    await expect(runner.compile()).rejects.toThrow("not available");
  });
});

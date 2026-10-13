import { describe, expect, it } from "vitest";
import { ClerkAuthVerifier, DevAuthVerifier, createAuthVerifier, hasPermission, isIndependentOf } from "../src";

describe("DevAuthVerifier", () => {
  it("refuses to run in production", () => {
    expect(() => new DevAuthVerifier("production")).toThrow();
    expect(() => createAuthVerifier({ mode: "dev", nodeEnv: "production" })).toThrow();
  });

  it("accepts only well-formed development tokens", async () => {
    const v = new DevAuthVerifier("development");
    expect(await v.verify("Bearer dev:dev|researcher")).toEqual({ ok: true, value: { subject: "dev|researcher", externalOrgId: null } });
    expect((await v.verify(undefined)).ok).toBe(false);
    expect((await v.verify("Bearer dev:user_123")).ok).toBe(false);
    expect((await v.verify("Basic abc")).ok).toBe(false);
  });
});

describe("ClerkAuthVerifier", () => {
  it("maps subject and organisation claims and hides provider errors", async () => {
    const good = new ClerkAuthVerifier({ secretKey: "sk_test", authorizedParties: [] }, (() =>
      Promise.resolve({ sub: "user_1", o: { id: "org_9" } })) as never);
    expect(await good.verify("Bearer t")).toEqual({ ok: true, value: { subject: "user_1", externalOrgId: "org_9" } });
    const bad = new ClerkAuthVerifier({ secretKey: "sk_test", authorizedParties: [] }, (() =>
      Promise.reject(new Error("jwt secret leaked here"))) as never);
    const result = await bad.verify("Bearer t");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("leaked");
  });

  it("requires a secret key", () => {
    expect(() => createAuthVerifier({ mode: "clerk", nodeEnv: "production" })).toThrow();
  });
});

describe("RBAC", () => {
  it("grants decisions only to committee members and admins", () => {
    expect(hasPermission(["COMMITTEE_MEMBER"], "decision:write")).toBe(true);
    expect(hasPermission(["ADMIN"], "decision:write")).toBe(true);
    expect(hasPermission(["RESEARCHER", "DEVELOPER"], "decision:write")).toBe(false);
  });

  it("does not let validators edit Pine source", () => {
    expect(hasPermission(["VALIDATOR"], "pine:write")).toBe(false);
  });

  it("does not let viewers write anything", () => {
    expect(hasPermission(["VIEWER"], "campaign:write")).toBe(false);
    expect(hasPermission(["VIEWER"], "read")).toBe(true);
  });

  it("detects authorship conflicts", () => {
    expect(isIndependentOf("a", ["b", null, "c"])).toBe(true);
    expect(isIndependentOf("a", ["b", "a"])).toBe(false);
  });
});

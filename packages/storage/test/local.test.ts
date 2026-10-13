import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalObjectStore, ObjectConflictError, assertOrgScoped, objectPaths } from "../src";

const store = () =>
  new LocalObjectStore(
    mkdtempSync(join(tmpdir(), "arf-store-")),
    "x".repeat(32),
    "http://api.local",
  );
const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("LocalObjectStore", () => {
  it("is write-once: identical re-put is a no-op, different content conflicts", async () => {
    const s = store();
    await s.putImmutable("orgs/o/a.txt", bytes("one"), "text/plain");
    await s.putImmutable("orgs/o/a.txt", bytes("one"), "text/plain");
    await expect(s.putImmutable("orgs/o/a.txt", bytes("two"), "text/plain")).rejects.toBeInstanceOf(
      ObjectConflictError,
    );
    expect(new TextDecoder().decode((await s.get("orgs/o/a.txt")) ?? new Uint8Array())).toBe("one");
  });

  it("refuses keys that escape the root", async () => {
    await expect(
      store().putImmutable("../../etc/passwd", bytes("x"), "text/plain"),
    ).rejects.toThrow();
    expect(() => assertOrgScoped("orgs/b/x", "a")).toThrow();
    expect(() => assertOrgScoped("orgs/a/../b/x", "a")).toThrow();
  });

  it("accepts presigned uploads only with matching size and checksum", async () => {
    const s = store();
    const body = bytes("Trade #,Type\n");
    const presigned = await s.presignPut({
      key: "orgs/o/up.csv",
      contentType: "text/csv",
      sizeBytes: body.byteLength,
      sha256Hex: sha(body),
      expiresInSeconds: 60,
    });
    const token = presigned.url.split("/").pop() ?? "";
    expect(await s.acceptUpload(token, bytes("tampered!!!!!"))).toMatchObject({ ok: false });
    expect(await s.acceptUpload(token, bytes("short"))).toMatchObject({ ok: false });
    expect(await s.acceptUpload(token, body)).toEqual({ ok: true, key: "orgs/o/up.csv" });
  });

  it("rejects forged and expired tokens", () => {
    const s = store();
    const token = s.sign({
      key: "orgs/o/k",
      contentType: "text/csv",
      sizeBytes: 1,
      sha256Hex: "0".repeat(64),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const [body] = token.split(".");
    expect(s.verifyToken(`${body ?? ""}.forged`)).toBeNull();
    const expired = s.sign({
      key: "orgs/o/k",
      contentType: "text/csv",
      sizeBytes: 1,
      sha256Hex: "0".repeat(64),
      exp: 1,
    });
    expect(s.verifyToken(expired)).toBeNull();
  });

  it("builds organisation-prefixed paths", () => {
    const base = objectPaths.version({
      orgId: "o",
      campaignId: "c",
      strategyId: "s",
      versionId: "v",
    });
    expect(objectPaths.verificationRaw(base, "ver", "abc")).toBe(
      "orgs/o/campaigns/c/strategies/s/versions/v/tradingview-verification/ver/raw/abc.csv",
    );
  });
});

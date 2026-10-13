import { describe, expect, it } from "vitest";
import { field } from "./form";
import { authHeaders, encodeSession, parseSession } from "./session";

describe("web session cookie", () => {
  it("round-trips a development session", () => {
    const raw = encodeSession({ subject: "dev|committee", org: "arf-dev" });
    expect(parseSession(raw)).toEqual({ subject: "dev|committee", org: "arf-dev" });
  });

  it("rejects tampered or malformed cookies instead of trusting them", () => {
    expect(parseSession(undefined)).toBeNull();
    expect(parseSession("not-base64-json")).toBeNull();
    expect(
      parseSession(
        Buffer.from(JSON.stringify({ subject: "clerk|user_1", org: "arf-dev" })).toString(
          "base64url",
        ),
      ),
    ).toBeNull();
    expect(
      parseSession(
        Buffer.from(JSON.stringify({ subject: "dev|admin", org: "../evil" })).toString("base64url"),
      ),
    ).toBeNull();
  });

  it("sends the organisation as a hint the API verifies against membership", () => {
    expect(authHeaders({ subject: "dev|researcher", org: "arf-dev" })).toEqual({
      authorization: "Bearer dev:dev|researcher",
      "x-arf-org": "arf-dev",
    });
  });
});

describe("form fields", () => {
  it("reads text values and treats files and missing fields as empty", () => {
    const f = new FormData();
    f.set("name", "Trend");
    f.set("upload", new Blob(["x"]), "a.csv");
    expect(field(f, "name")).toBe("Trend");
    expect(field(f, "upload")).toBe("");
    expect(field(f, "missing")).toBe("");
  });
});

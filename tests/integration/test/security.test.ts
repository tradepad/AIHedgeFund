import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@arf/contracts/node";
import { ApiClient, expectStatus } from "../src/client";
import { fixtureBytes, prepareVersion, uploadReport } from "../src/flow";
import { startStack, waitFor, type Stack } from "../src/harness";

type Json = Record<string, unknown>;

describe("authentication, organisation isolation and protected data", () => {
  let stack: Stack;
  let api: ApiClient;
  beforeAll(async () => {
    stack = await startStack({ rateLimitMax: 6 });
    api = new ApiClient(stack.baseUrl, "researcher");
  });
  afterAll(async () => {
    await stack.stop();
  });

  it("rejects missing credentials and unknown organisations", async () => {
    const anon = await fetch(`${stack.baseUrl}/v1/campaigns`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toContain("application/problem+json");
    const noOrg = await fetch(`${stack.baseUrl}/v1/campaigns`, { headers: { authorization: "Bearer dev:dev|researcher" } });
    expect(noOrg.status).toBe(400);
  });

  it("never lets a member of another organisation read or act on this organisation's data", async () => {
    const prepared = await prepareVersion(api);
    const outsider = api.as("outsider");
    const asMember = await outsider.get<Json>(`/v1/campaigns/${prepared.campaignId}`);
    expect(asMember.status).toBe(403);
    expect(asMember.body.code).toBe("NOT_A_MEMBER");
    const ownOrg = api.as("outsider", "arf-other");
    expect((await ownOrg.get(`/v1/campaigns/${prepared.campaignId}`)).status).toBe(404);
    expect((await ownOrg.get(`/v1/strategy-versions/${prepared.versionId}`)).status).toBe(404);
    expect((await ownOrg.get(`/v1/strategy-versions/${prepared.versionId}/pine`)).status).toBe(404);
    expect((await ownOrg.post(`/v1/strategies/${prepared.strategyId}/versions`, { kind: "ROOT", symbol: "BYBIT:BTCUSDT.P", timeframe: "60", changeReason: "hijack" })).status).toBe(404);
    const library = expectStatus<{ items: Json[] }>(await ownOrg.get("/v1/strategy-library"), 200);
    expect(library.items).toHaveLength(0);
  });

  it("enforces role permissions", async () => {
    const viewer = api.as("viewer");
    const res = await viewer.post<Json>("/v1/campaigns", { name: "Viewer campaign", objective: "should not be allowed", assetClasses: ["crypto"], timeframes: ["60"] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
    expect((await api.get("/v1/audit")).status).toBe(403);
  });

  it("rejects idempotency-key reuse with a different body", async () => {
    const body = { name: "Idem campaign", objective: "Check idempotency behaviour", assetClasses: ["crypto"], timeframes: ["60"] };
    expect((await api.post("/v1/campaigns", body, "idem-key-reuse-1")).status).toBe(201);
    const reuse = await api.post<Json>("/v1/campaigns", { ...body, name: "Different" }, "idem-key-reuse-1");
    expect(reuse.status).toBe(422);
    expect(reuse.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await api.post("/v1/campaigns", body)).status).toBe(201);
  });

  it("verifies upload checksums and the operator's Pine source attestation", async () => {
    const prepared = await prepareVersion(api);
    const verification = expectStatus<Json>(await api.post("/v1/tradingview-verifications", { strategyVersionId: prepared.versionId, chartTimezone: "Etc/UTC", dateFrom: "2024-01-01", dateTo: "2024-04-30" }), 201);
    const vid = String(verification.id);
    const bytes = fixtureBytes("classic-performance-summary.csv");
    const presigned = expectStatus<Json>(await api.post(`/v1/tradingview-verifications/${vid}/uploads`, { reportType: "PERFORMANCE_SUMMARY", fileName: "summary.csv", contentType: "text/csv", sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) }), 201);
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 2] = 0x39;
    const bad = await fetch(String(presigned.url), { method: "PUT", headers: { "content-type": "text/csv" }, body: tampered });
    expect(bad.status).toBe(403);
    const notReceived = await api.post<Json>(`/v1/tradingview-verifications/${vid}/uploads/complete`, { uploadId: presigned.uploadId, attestedPineSourceHash: prepared.pineSourceHash, attestedSettingsMatch: true });
    expect(notReceived.status).toBe(422);
    expect(notReceived.body.code).toBe("UPLOAD_NOT_RECEIVED");
    expect((await fetch(String(presigned.url), { method: "PUT", headers: { "content-type": "text/csv" }, body: bytes })).status).toBe(200);
    const wrongHash = await api.post<Json>(`/v1/tradingview-verifications/${vid}/uploads/complete`, { uploadId: presigned.uploadId, attestedPineSourceHash: "0".repeat(64), attestedSettingsMatch: true });
    expect(wrongHash.status).toBe(422);
    expect(wrongHash.body.code).toBe("ATTESTED_SOURCE_MISMATCH");
    const noAttest = await api.post<Json>(`/v1/tradingview-verifications/${vid}/uploads/complete`, { uploadId: presigned.uploadId, attestedPineSourceHash: prepared.pineSourceHash, attestedSettingsMatch: false });
    expect(noAttest.status).toBe(400);
    await uploadReport(api, vid, "LIST_OF_TRADES", fixtureBytes("classic-list-of-trades.csv"), "trades.csv", prepared.pineSourceHash);
  });

  it("rate limits upload completion", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await api.post(`/v1/tradingview-verifications/01900000-0000-7000-8000-000000000000/uploads/complete`, { uploadId: "01900000-0000-7000-8000-000000000001", attestedPineSourceHash: "0".repeat(64), attestedSettingsMatch: true });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });

  it("requires protected:read for raw model output and audits every protected read", async () => {
    const campaign = expectStatus<Json>(await api.post("/v1/campaigns", { name: "Agent campaign", objective: "Generate an idea with the fixture provider", assetClasses: ["crypto"], timeframes: ["60"] }), 201);
    const requested = expectStatus<Json>(await api.post(`/v1/campaigns/${String(campaign.id)}/ideas/generate`, { objective: "Find a trend pullback idea for BTC perpetuals" }), 202);
    const task = await waitFor("idea task to reach HYPOTHESIS_DRAFT", async () => {
      const tasks = expectStatus<{ items: Json[] }>(await api.get(`/v1/campaigns/${String(campaign.id)}/tasks`), 200);
      return tasks.items.find((t) => t.id === requested.taskId && t.state === "HYPOTHESIS_DRAFT");
    });
    expect(task).toBeTruthy();
    const [run] = await stack.db.handle.db.query.agentRuns.findMany();
    const rawId = run?.rawOutputArtefactId ?? "";
    expect(rawId).not.toBe("");
    const denied = await api.get<Json>(`/v1/artefacts/${rawId}/content`);
    expect(denied.status).toBe(403);
    const committee = api.as("committee");
    const allowed = await fetch(`${stack.baseUrl}/v1/artefacts/${rawId}/content`, { headers: { authorization: "Bearer dev:dev|committee", "x-arf-org": "arf-dev" } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
    const audit = expectStatus<{ items: Json[] }>(await committee.get("/v1/audit?limit=20"), 200);
    expect(audit.items.some((e) => e.action === "PROTECTED_ARTEFACT_READ" && e.aggregateId === rawId)).toBe(true);
  });
});

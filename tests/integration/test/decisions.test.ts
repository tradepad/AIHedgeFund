import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, expectStatus } from "../src/client";
import { prepareVersion, verifyWithFixtures, type PreparedVersion } from "../src/flow";
import { startStack, type Stack } from "../src/harness";

type Json = Record<string, unknown>;

const submitForReview = (api: ApiClient, versionId: string) =>
  api.post(`/v1/strategy-versions/${versionId}/transitions`, { to: "PAPER_APPROVAL_REVIEW", reasonCodes: ["VERIFICATION_COMPLETE"], summary: "verification and parity complete", evidenceIds: [] });

const decision = (versionId: string, kind: "PAPER_APPROVED" | "REJECT" | "REWORK_WITH_NEW_VERSION", extra: Json = {}) => ({
  strategyVersionId: versionId,
  decision: kind,
  reasonCodes: ["COMMITTEE_REVIEW"],
  summary: "Committee reviewed the verification evidence.",
  rejectionCase: "Only twelve trades over four months; the sample is far too small to trust.",
  parityReportId: null,
  acknowledgement: true,
  ...extra,
});

describe("committee decisions and promotion gates", () => {
  let stack: Stack;
  let researcher: ApiClient;
  let committee: ApiClient;
  beforeAll(async () => {
    stack = await startStack();
    researcher = new ApiClient(stack.baseUrl, "researcher");
    committee = researcher.as("committee");
  });
  afterAll(async () => {
    await stack.stop();
  });

  it("approves only with evidence, an explicit override for warnings, and an independent committee member", async () => {
    const prepared = await prepareVersion(researcher);
    await verifyWithFixtures(researcher, prepared);
    expectStatus(await submitForReview(researcher, prepared.versionId), 200);

    const context = expectStatus<{ evidence: Json; overridableWarnings: string[] }>(await committee.get(`/v1/strategy-versions/${prepared.versionId}/decision-context`), 200);
    expect(context.overridableWarnings).toEqual(expect.arrayContaining(["LOW_TRADE_COUNT", "PARITY_WARN"]));
    expect(context.evidence.missingEvidence).toEqual([]);

    // The author lacks decision rights entirely.
    expect((await researcher.post("/v1/committee/decisions", decision(prepared.versionId, "PAPER_APPROVED"))).status).toBe(403);

    // Warnings require an explicit override.
    const noOverride = await committee.post<Json>("/v1/committee/decisions", decision(prepared.versionId, "PAPER_APPROVED"));
    expect(noOverride.status).toBe(422);
    expect(noOverride.body.code).toBe("OVERRIDE_REQUIRED");

    // A stale parity report id is refused.
    const stale = await committee.post<Json>("/v1/committee/decisions", decision(prepared.versionId, "PAPER_APPROVED", { parityReportId: "01900000-0000-7000-8000-000000000000" }));
    expect(stale.status).toBe(409);

    const body = decision(prepared.versionId, "PAPER_APPROVED", { humanOverride: true, overrideReason: "Paper trading only; sample size is the explicit purpose of the paper phase." });
    const approved = await committee.post<Json>("/v1/committee/decisions", body, "decision-key-0001");
    expect(approved.status).toBe(201);
    expect(approved.body.humanOverride).toBe(true);

    // Same key and body replays; a second decision is refused.
    const replay = await committee.post<Json>("/v1/committee/decisions", body, "decision-key-0001");
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(replay.body.id).toBe(approved.body.id);
    expect((await committee.post("/v1/committee/decisions", body)).status).toBe(409);

    const version = expectStatus<Json>(await researcher.get(`/v1/strategy-versions/${prepared.versionId}`), 200);
    expect(version.state).toBe("PAPER_APPROVED");
    const audit = expectStatus<{ items: Json[] }>(await committee.get(`/v1/strategy-versions/${prepared.versionId}/audit?limit=200`), 200);
    const actions = audit.items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["DECISION_RECORDED", "HUMAN_OVERRIDE", "STATE_TRANSITIONED", "PARITY_REPORT_CREATED", "REPORT_PARSED", "BACKTEST_RUN_RECORDED"]));
  });

  it("blocks promotion on parity FAIL and allows only rejection", async () => {
    const prepared: PreparedVersion = await prepareVersion(researcher);
    // Tamper with trade 12's exit price so its reported P&L cannot be reproduced.
    const { verificationId } = await verifyWithFixtures(researcher, prepared, "classic", { trades: (csv) => csv.replace("2024-04-24 14:00,66310.0", "2024-04-24 14:00,66910.0") });
    const parity = expectStatus<Json>(await researcher.get(`/v1/tradingview-verifications/${verificationId}/parity`), 200);
    expect(parity.status).toBe("FAIL");
    expect((parity.firstDivergence as Json).check).toBe("TRADE_PNL_SEQUENCE");

    const review = await submitForReview(researcher, prepared.versionId);
    expect(review.status).toBe(422);
    expect((review.body as Json).code).toBe("HARD_FAIL");

    const approve = await committee.post<Json>("/v1/committee/decisions", decision(prepared.versionId, "PAPER_APPROVED", { humanOverride: true, overrideReason: "attempting to override a parity failure" }));
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe("INVALID_STATE");

    const rejected = await committee.post<Json>("/v1/committee/decisions", decision(prepared.versionId, "REJECT"));
    expect(rejected.status).toBe(201);
    const version = expectStatus<Json>(await researcher.get(`/v1/strategy-versions/${prepared.versionId}`), 200);
    expect(version.state).toBe("REJECTED");
  });

  it("refuses approval by an author of the version (separation of duties)", async () => {
    const admin = researcher.as("admin");
    const prepared = await prepareVersion(admin);
    await verifyWithFixtures(admin, prepared);
    expectStatus(await submitForReview(admin, prepared.versionId), 200);
    const res = await admin.post<Json>("/v1/committee/decisions", decision(prepared.versionId, "PAPER_APPROVED", { humanOverride: true, overrideReason: "self approval must be refused by policy" }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SEPARATION_OF_DUTIES");
  });

  it("keeps tested versions immutable and records rework as a child version", async () => {
    const prepared = await prepareVersion(researcher);
    const template = expectStatus<Json>(await researcher.get(`/v1/strategy-versions/${prepared.versionId}/pine/template?initialCapital=10000&currency=USDT`), 200);
    const again = await researcher.put<Json>(`/v1/strategy-versions/${prepared.versionId}/pine`, { source: template.source, manifest: template.manifest });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("PINE_IMMUTABLE");
    const sdlAgain = await researcher.put<Json>(`/v1/strategy-versions/${prepared.versionId}/definition`, { definition: {} });
    expect(sdlAgain.status).toBe(400);

    const child = expectStatus<Json>(
      await researcher.post(`/v1/strategies/${prepared.strategyId}/versions`, {
        kind: "CHILD",
        parentVersionId: prepared.versionId,
        symbol: "BYBIT:BTCUSDT.P",
        timeframe: "60",
        changeReason: "widen the ATR stop after reviewing losses",
        changeCategories: ["PARAMETERS"],
        changedFields: ["parameters.stop_atr.default"],
        motivatingEvidenceIds: [],
        contaminatedData: ["2024-01-01..2024-04-30 BYBIT:BTCUSDT.P 60"],
      }),
      201,
    );
    expect(child.versionNumber).toBe(2);
    expect(child.parentVersionId).toBe(prepared.versionId);
    const lineage = expectStatus<{ items: Json[] }>(await researcher.get(`/v1/strategy-versions/${String(child.id)}/lineage`), 200);
    expect(lineage.items).toHaveLength(2);
    expect(lineage.items[1]?.contaminatedData).toEqual(["2024-01-01..2024-04-30 BYBIT:BTCUSDT.P 60"]);
  });
});

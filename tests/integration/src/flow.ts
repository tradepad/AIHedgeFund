import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleIdeaCard, exampleStrategyDefinition } from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { expectStatus, type ApiClient } from "./client";
import { FIXTURES_DIR, waitFor } from "./harness";

type Json = Record<string, unknown>;
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`${what} missing from response`);
  return v;
};

export const FIXTURE_REPORTS = {
  classic: { summary: "classic-performance-summary.csv", trades: "classic-list-of-trades.csv", chartTimezone: "Etc/UTC" },
  pnl: { summary: "pnl-performance-summary.csv", trades: "pnl-list-of-trades.csv", chartTimezone: "America/New_York" },
} as const;

export interface PreparedVersion {
  campaignId: string;
  strategyId: string;
  versionId: string;
  definitionId: string;
  pineRevisionId: string;
  pineSourceHash: string;
}

/** Campaign → idea → strategy → root version → SDL → Pine → TRADINGVIEW_VERIFICATION. */
export async function prepareVersion(api: ApiClient, name = `Trend pullback ${Date.now().toString(36)}`): Promise<PreparedVersion> {
  const campaign = expectStatus<Json>(await api.post("/v1/campaigns", { name: `Campaign ${name}`, objective: "Find robust crypto trend pullback strategies", assetClasses: ["crypto"], timeframes: ["60"] }), 201);
  const campaignId = str(campaign.id, "campaign id");
  const idea = expectStatus<Json>(await api.post(`/v1/campaigns/${campaignId}/ideas`, { ideaCard: exampleIdeaCard }), 201);
  const strategy = expectStatus<Json>(await api.post("/v1/strategies", { campaignId, name, family: "trend_following", ideaCardId: str(idea.id, "idea id") }), 201);
  const strategyId = str(strategy.id, "strategy id");
  const version = expectStatus<Json>(await api.post(`/v1/strategies/${strategyId}/versions`, { kind: "ROOT", symbol: "BYBIT:BTCUSDT.P", timeframe: "60", changeReason: "initial hypothesis" }), 201);
  const versionId = str(version.id, "version id");
  const definition = expectStatus<Json>(await api.put(`/v1/strategy-versions/${versionId}/definition`, { definition: exampleStrategyDefinition }), 201);
  const definitionId = str(definition.id, "definition id");
  expectStatus(await api.post(`/v1/strategy-versions/${versionId}/transitions`, { to: "PINE_DEVELOPMENT", reasonCodes: ["SDL_COMPLETE"], summary: "definition attached", evidenceIds: [definitionId] }), 200);
  const template = expectStatus<Json>(await api.get(`/v1/strategy-versions/${versionId}/pine/template?initialCapital=10000&currency=USDT`), 200);
  const pine = expectStatus<Json>(await api.put(`/v1/strategy-versions/${versionId}/pine`, { source: template.source, manifest: template.manifest }), 201);
  const pineRevisionId = str(pine.id, "pine revision id");
  expectStatus(await api.post(`/v1/strategy-versions/${versionId}/transitions`, { to: "TRADINGVIEW_VERIFICATION", reasonCodes: ["PINE_READY"], summary: "lint passed; ready for TradingView", evidenceIds: [definitionId, pineRevisionId] }), 200);
  return { campaignId, strategyId, versionId, definitionId, pineRevisionId, pineSourceHash: str(pine.sourceHash, "source hash") };
}

/** Request a presigned upload, PUT the bytes, then complete with attestation. */
export async function uploadReport(api: ApiClient, verificationId: string, reportType: "PERFORMANCE_SUMMARY" | "LIST_OF_TRADES", bytes: Uint8Array, fileName: string, attestedPineSourceHash: string): Promise<Json> {
  const presigned = expectStatus<Json>(await api.post(`/v1/tradingview-verifications/${verificationId}/uploads`, { reportType, fileName, contentType: "text/csv", sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) }), 201);
  const put = await fetch(str(presigned.url, "upload url"), { method: "PUT", headers: { "content-type": "text/csv" }, body: bytes });
  if (!put.ok) throw new Error(`presigned PUT failed with ${put.status}: ${await put.text()} url=${String(presigned.url).slice(0, 60)}`);
  return expectStatus<Json>(await api.post(`/v1/tradingview-verifications/${verificationId}/uploads/complete`, { uploadId: presigned.uploadId, attestedPineSourceHash, attestedSettingsMatch: true }), 200);
}

export function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

/** Create a verification, upload both fixture exports and wait for parity. */
export async function verifyWithFixtures(
  api: ApiClient,
  prepared: PreparedVersion,
  variant: keyof typeof FIXTURE_REPORTS = "classic",
  transform: { trades?: (csv: string) => string } = {},
): Promise<{ verificationId: string; status: Json }> {
  const f = FIXTURE_REPORTS[variant];
  const tradesBytes = transform.trades ? new TextEncoder().encode(transform.trades(new TextDecoder().decode(fixtureBytes(f.trades)))) : fixtureBytes(f.trades);
  const verification = expectStatus<Json>(
    await api.post("/v1/tradingview-verifications", {
      strategyVersionId: prepared.versionId,
      chartTimezone: f.chartTimezone,
      dateFrom: "2024-01-01",
      dateTo: "2024-04-30",
      barMagnifier: false,
    }),
    201,
  );
  const verificationId = str(verification.id, "verification id");
  await uploadReport(api, verificationId, "PERFORMANCE_SUMMARY", fixtureBytes(f.summary), f.summary, prepared.pineSourceHash);
  await uploadReport(api, verificationId, "LIST_OF_TRADES", tradesBytes, f.trades, prepared.pineSourceHash);
  const status = await waitFor("verification to complete", async () => {
    const res = await api.get<{ verification: Json }>(`/v1/tradingview-verifications/${verificationId}`);
    const s = res.body.verification.status;
    if (s === "PARSE_FAILED") throw new Error(`verification failed to parse: ${JSON.stringify(res.body)}`);
    return s === "COMPLETED" ? (res.body as Json) : null;
  });
  return { verificationId, status };
}

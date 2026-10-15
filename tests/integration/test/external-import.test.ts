import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExternalEvidenceViewSchema,
  ExternalImportBundleSchema,
  err,
  type ExternalImportBundle,
} from "@arf/contracts";
import type { AppContext, RequestScope } from "@arf/api/context";
import { ConfigSchema } from "@arf/api/config";
import { importExternalBundle } from "@arf/api/services/external-evidence";
import { resolvePrincipal } from "@arf/auth";
import { createLogger } from "@arf/observability";
import { WorkflowEngine } from "@arf/workflow";
import { ApiClient } from "../src/client";
import { TEST_REDIS_URL, startStack, type Stack } from "../src/harness";

const PINE = '//@version=6\nstrategy("ext", overlay=true)\n';

function bundle(overrides: { pf?: string } = {}): ExternalImportBundle {
  return ExternalImportBundleSchema.parse({
    schemaVersion: "1.0.0",
    batchId: "it-batch",
    title: "Integration batch",
    description: "Two versions of one strategy and a not-run strategy.",
    campaigns: [
      {
        name: "External campaign",
        objective: "Exercise the external evidence import path.",
        assetClasses: ["crypto"],
        timeframes: ["60"],
        strategies: [
          {
            name: "Ext Supertrend",
            family: "trend_following",
            versions: [
              {
                key: "it-batch/st/v1",
                symbol: "BYBIT:BTCUSDT.P",
                timeframe: "60",
                description: "root",
                change: null,
                externalStrategyId: "ext-1",
                source: { language: "PINE", code: PINE },
                results: [
                  {
                    key: "it-batch/st/v1/is",
                    engine: "TRADER_DEV",
                    engineVersion: "tv",
                    provenance: "OUR_RUN",
                    segment: "IN_SAMPLE",
                    runStatus: "COMPLETED",
                    windowFrom: "2020-01-01",
                    windowTo: "2024-12-31",
                    externalResultId: "r1",
                    metrics: {
                      closedTradeCount: 160,
                      profitFactor: overrides.pf ?? "1.57",
                      maxDrawdownPct: "28.2",
                      netProfitPct: "260",
                      netProfit: "25997",
                      largestWin: "4066",
                      currency: "USDT",
                    },
                    extraMetrics: {},
                    settings: { commissionPctPerSide: 0.05 },
                    verdict: "PASS",
                    verdictReasons: [],
                    notes: [],
                  },
                ],
              },
              {
                key: "it-batch/st/v2",
                symbol: "BYBIT:BTCUSDT.P",
                timeframe: "60",
                description: "tweak",
                change: { categories: ["PARAMETERS"], fields: ["factor 4 -> 3"] },
                externalStrategyId: null,
                source: null,
                results: [
                  {
                    key: "it-batch/st/v2/is",
                    engine: "TRADER_DEV",
                    engineVersion: null,
                    provenance: "OUR_RUN",
                    segment: "IN_SAMPLE",
                    runStatus: "NOT_RUN",
                    windowFrom: null,
                    windowTo: null,
                    externalResultId: null,
                    metrics: {
                      closedTradeCount: null,
                      profitFactor: null,
                      maxDrawdownPct: null,
                      netProfitPct: null,
                      netProfit: null,
                      largestWin: null,
                      currency: null,
                    },
                    extraMetrics: {},
                    settings: {},
                    verdict: "NOT_EVALUATED",
                    verdictReasons: [],
                    notes: ["Pine v5"],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("external evidence import", () => {
  let stack: Stack;
  let ctx: AppContext;
  let scope: RequestScope;
  let api: ApiClient;
  const run = (b: ExternalImportBundle) =>
    stack.db.handle.db.transaction((tx) => importExternalBundle(ctx, tx, scope, b));

  beforeAll(async () => {
    stack = await startStack({ workers: false });
    api = new ApiClient(stack.baseUrl, "researcher");
    ctx = {
      config: ConfigSchema.parse({
        NODE_ENV: "test",
        DATABASE_URL: stack.db.url,
        REDIS_URL: TEST_REDIS_URL,
        LOCAL_STORAGE_SIGNING_SECRET: "integration-test-signing-secret-0123456789",
        LOCAL_STORAGE_DIR: "/tmp",
      }),
      db: stack.db.handle.db,
      store: stack.store,
      auth: {
        mode: "dev",
        verify: () => Promise.resolve(err({ code: "UNAUTHENTICATED", detail: "unused" })),
      },
      workflow: new WorkflowEngine(),
      logger: createLogger("it", { level: "silent" }),
      bus: null,
    };
    const principal = await resolvePrincipal(
      stack.db.handle.db,
      { subject: "dev|researcher", externalOrgId: null },
      "arf-dev",
    );
    if (!principal.ok) throw new Error(principal.error.detail);
    scope = { principal: principal.value, traceId: "it-trace", correlationId: "it-trace" };
  });
  afterAll(async () => {
    await stack.stop();
  });

  it("creates the registry rows once and is idempotent on re-run", async () => {
    const first = await run(bundle());
    expect(first.campaigns.created).toBe(1);
    expect(first.strategies.created).toBe(1);
    expect(first.versions.created).toBe(2);
    expect(first.results.created).toBe(2);

    const second = await run(bundle());
    expect(second.versions).toEqual({ created: 0, reused: 2 });
    expect(second.results).toEqual({ created: 0, reused: 2 });
    expect(second.versionIds).toEqual(first.versionIds);

    const [root, child] = first.versionIds;
    const childView = await api.get<Record<string, unknown>>(`/v1/strategy-versions/${child}`);
    expect(childView.body.parentVersionId).toBe(root);
    expect(childView.body.state).toBe("HYPOTHESIS_DRAFT");

    const lineage = await api.get<{ items: { contaminatedData: string[] }[] }>(
      `/v1/strategy-versions/${child}/lineage`,
    );
    expect(lineage.body.items[1]?.contaminatedData).toEqual([
      "external:TRADER_DEV:BYBIT:BTCUSDT.P:60:2020-01-01..2024-12-31",
    ]);
  });

  it("serves external evidence with the source and labels nothing as ARF metrics", async () => {
    const summary = await run(bundle());
    const res = await api.get(`/v1/strategy-versions/${summary.versionIds[0]}/external-evidence`);
    expect(res.status).toBe(200);
    const view = ExternalEvidenceViewSchema.parse(res.body);
    expect(view.import?.source?.code).toBe(PINE);
    expect(view.results[0]?.metrics.profitFactor).toBe("1.57");
    expect(view.results[0]?.metrics.closedTradeCount).toBe(160);

    const metrics = await stack.db.handle.db.execute(
      sql`SELECT count(*)::int AS n FROM metric_snapshots`,
    );
    expect(metrics.rows[0]).toEqual({ n: 0 });
  });

  it("rejects reuse of a result key with different content", async () => {
    await expect(run(bundle({ pf: "9.99" }))).rejects.toMatchObject({ code: "IMPORT_KEY_REUSED" });
  });

  it("hides external evidence from other organisations", async () => {
    const summary = await run(bundle());
    const res = await api
      .as("outsider", "arf-other")
      .get(`/v1/strategy-versions/${summary.versionIds[0]}/external-evidence`);
    expect(res.status).toBe(404);
  });

  it("keeps external evidence append-only", async () => {
    const error = await stack.db.handle.db
      .execute(sql`UPDATE external_backtest_results SET verdict = 'PASS'`)
      .then(
        () => "no error",
        (e: unknown) =>
          e instanceof Error && e.cause instanceof Error ? e.cause.message : String(e),
      );
    expect(error).toContain("ARF_IMMUTABLE");
  });
});

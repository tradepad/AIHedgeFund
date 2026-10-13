import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@arf/db";
import { ApiClient, expectStatus } from "../src/client";
import { prepareVersion, verifyWithFixtures } from "../src/flow";
import { startStack, waitFor, type Stack } from "../src/harness";

type Json = Record<string, unknown>;

describe("verification pipeline (API → outbox → BullMQ → workers)", () => {
  let stack: Stack;
  let api: ApiClient;
  beforeAll(async () => {
    stack = await startStack();
    api = new ApiClient(stack.baseUrl, "researcher");
  });
  afterAll(async () => {
    await stack.stop();
  });

  it("parses both exports, reconstructs the ledger and produces a parity report", async () => {
    const prepared = await prepareVersion(api);
    const { verificationId, status } = await verifyWithFixtures(api, prepared, "classic");
    const verification = status.verification as Json;
    const runId = verification.backtestRunId as string;
    expect(runId).toBeTruthy();

    const trades = expectStatus<{ items: Json[]; nextCursor: string | null }>(
      await api.get(`/v1/backtest-runs/${runId}/trades?limit=5`),
      200,
    );
    expect(trades.items).toHaveLength(5);
    const page2 = expectStatus<{ items: Json[]; nextCursor: string | null }>(
      await api.get(`/v1/backtest-runs/${runId}/trades?limit=50&cursor=${trades.nextCursor ?? ""}`),
      200,
    );
    expect(page2.items).toHaveLength(7);

    const equity = expectStatus<{ equity: Json[]; drawdown: Json[]; label: string }>(
      await api.get(`/v1/backtest-runs/${runId}/equity`),
      200,
    );
    expect(equity.label).toBe("HISTORICAL_SIMULATED");
    expect(equity.equity).toHaveLength(13);
    // ARF recomputes exact P&L; TradingView rounds each trade to cents.
    expect(equity.equity.at(-1)?.equity).toBe("10201.088679320000");

    const metrics = expectStatus<{ calculated: Json[]; reported: Json[] }>(
      await api.get(`/v1/backtest-runs/${runId}/metrics`),
      200,
    );
    const calc = (name: string) =>
      metrics.calculated.find((m) => m.metricName === name && m.periodKey === "")?.value;
    expect(calc("closed_trade_count")).toBe("12.000000000000");
    expect(calc("net_profit")).toBe("201.088679320000");
    expect(metrics.reported.find((m) => m.metricName === "net_profit")?.value).toBe(
      "201.090000000000",
    );

    const parity = expectStatus<{ status: string; checks: Json[]; firstDivergence: Json | null }>(
      await api.get(`/v1/tradingview-verifications/${verificationId}/parity`),
      200,
    );
    expect(parity.status).toBe("WARN");
    expect(parity.checks.find((c) => c.check === "NET_PROFIT")?.status).toBe("PASS");
    expect(parity.checks.find((c) => c.check === "TRADE_COUNT")?.status).toBe("PASS");

    const library = await waitFor("library row with parity", async () => {
      const res = expectStatus<{ items: Json[] }>(
        await api.get(`/v1/strategy-library?campaignId=${prepared.campaignId}`),
        200,
      );
      return res.items.find(
        (r) => r.strategyVersionId === prepared.versionId && r.parityStatus !== null,
      );
    });
    expect(library.closedTradeCount).toBe(12);

    const chain = await verifyAuditChain(
      stack.db.handle.db,
      (await stack.db.handle.db.query.organisations.findFirst())?.id ?? "",
    );
    expect(chain.valid).toBe(true);
  });

  it("produces identical results from the semicolon / comma-decimal / New York export layout", async () => {
    const prepared = await prepareVersion(api);
    const { verificationId } = await verifyWithFixtures(api, prepared, "pnl");
    const parity = expectStatus<{ status: string; checks: Json[] }>(
      await api.get(`/v1/tradingview-verifications/${verificationId}/parity`),
      200,
    );
    expect(parity.checks.find((c) => c.check === "TRADE_PNL_SEQUENCE")?.status).toBe("PASS");
    expect(parity.checks.find((c) => c.check === "NET_PROFIT")?.status).toBe("PASS");
  });
});

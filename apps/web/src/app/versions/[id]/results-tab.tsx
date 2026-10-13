import Link from "next/link";
import { z } from "zod";
import {
  BacktestRunViewSchema,
  EquitySeriesSchema,
  MetricsViewSchema,
  TradeSchema,
  VerificationSchema,
  pageOf,
  type MetricSnapshot,
  type StrategyVersion,
} from "@arf/contracts";
import { EmptyState, EvidenceLabel, formatDecimal, formatMetric, shortHash } from "@arf/ui";
import { EquityChart } from "@/components/equity-chart";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";

export async function latestRunId(
  versionId: string,
): Promise<{ verificationId: string; runId: string | null } | null> {
  const res = await apiGet(
    `/v1/strategy-versions/${versionId}/verifications`,
    z.object({ items: z.array(VerificationSchema) }),
  );
  if (!res.ok) return null;
  const v = res.data.items[0];
  return v ? { verificationId: v.id, runId: v.backtestRunId } : null;
}

export async function ResultsTab({
  version,
  cursor,
}: {
  version: StrategyVersion;
  cursor: string | undefined;
}) {
  const latest = await latestRunId(version.id);
  if (!latest?.runId)
    return (
      <EmptyState title="No results yet">
        Results appear after a TradingView verification has been uploaded and processed.
      </EmptyState>
    );
  const runId = latest.runId;
  const [run, metrics, equity, trades] = await Promise.all([
    apiGet(`/v1/backtest-runs/${runId}`, BacktestRunViewSchema),
    apiGet(`/v1/backtest-runs/${runId}/metrics`, MetricsViewSchema),
    apiGet(`/v1/backtest-runs/${runId}/equity`, EquitySeriesSchema),
    apiGet(
      `/v1/backtest-runs/${runId}/trades?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      pageOf(TradeSchema),
    ),
  ]);
  if (!run.ok) return <ProblemView problem={run.problem} />;
  const r = run.data;
  return (
    <div className="stack">
      <section className="card">
        <div className="row spread">
          <h2>Backtest run</h2>
          <div className="row">
            <EvidenceLabel kind="SIMULATED" />
            <EvidenceLabel kind="TRADINGVIEW" />
          </div>
        </div>
        <dl className="kv">
          <dt>Runner</dt>
          <dd className="mono">
            {r.runnerType} · {r.runnerVersion}
          </dd>
          <dt>Source / settings</dt>
          <dd className="mono">
            {shortHash(r.sourceHash)} / {shortHash(r.settingsHash)}
          </dd>
          <dt>Capital</dt>
          <dd>
            {formatDecimal(r.initialCapital)} {r.currency}
          </dd>
          <dt>Completed</dt>
          <dd>
            <Utc value={r.completedAt} />
          </dd>
        </dl>
      </section>
      <section className="card">
        <div className="row spread">
          <h2>Equity and drawdown</h2>
          <EvidenceLabel kind="ARF_CALCULATED" />
        </div>
        {equity.ok ? (
          <EquityChart series={equity.data} />
        ) : (
          <ProblemView problem={equity.problem} />
        )}
      </section>
      <section className="card">
        <h2>Metrics</h2>
        {metrics.ok ? (
          <MetricsTable
            calculated={metrics.data.calculated}
            reported={metrics.data.reported}
            currency={r.currency}
          />
        ) : (
          <ProblemView problem={metrics.problem} />
        )}
      </section>
      <section className="card">
        <div className="row spread">
          <h2>Trade ledger</h2>
          <span className="muted">
            Net P&amp;L: TradingView reported vs ARF recomputed from prices and declared costs
          </span>
        </div>
        {!trades.ok ? (
          <ProblemView problem={trades.problem} />
        ) : trades.data.items.length === 0 ? (
          <EmptyState title="No closed trades" />
        ) : (
          <>
            <table data-testid="trades-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Side</th>
                  <th>Entry (UTC)</th>
                  <th>Exit (UTC)</th>
                  <th className="num">Entry</th>
                  <th className="num">Exit</th>
                  <th className="num">Qty</th>
                  <th className="num">TV net</th>
                  <th className="num">ARF net</th>
                  <th className="num">ARF commission</th>
                </tr>
              </thead>
              <tbody>
                {trades.data.items.map((t) => (
                  <tr key={t.id}>
                    <td className="num">{t.tradeNumber}</td>
                    <td>{t.direction.toLowerCase()}</td>
                    <td className="mono">{t.entryTime.replace("T", " ").replace("Z", "")}</td>
                    <td className="mono">{t.exitTime.replace("T", " ").replace("Z", "")}</td>
                    <td className="num">{formatDecimal(t.entryPrice)}</td>
                    <td className="num">{formatDecimal(t.exitPrice)}</td>
                    <td className="num">{formatDecimal(t.quantity, 4)}</td>
                    <td className="num">{formatDecimal(t.reportedNetPnl)}</td>
                    <td className="num">{formatDecimal(t.calcNetPnl)}</td>
                    <td className="num">{formatDecimal(t.calcCommission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trades.data.nextCursor ? (
              <Link
                href={`/versions/${version.id}?tab=results&cursor=${encodeURIComponent(trades.data.nextCursor)}`}
              >
                Next trades →
              </Link>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

const ORDER = [
  "closed_trade_count",
  "net_profit",
  "gross_profit",
  "gross_loss",
  "profit_factor",
  "win_rate_pct",
  "average_win",
  "average_loss",
  "payoff_ratio",
  "max_drawdown",
  "max_drawdown_pct",
  "longest_losing_streak",
  "average_holding_seconds",
  "total_return_pct",
  "commission_paid",
  "initial_capital",
];

function MetricsTable({
  calculated,
  reported,
  currency,
}: {
  calculated: MetricSnapshot[];
  reported: MetricSnapshot[];
  currency: string;
}) {
  const whole = calculated.filter((m) => m.periodKey === "");
  const monthly = calculated.filter(
    (m) => m.metricName === "monthly_return_pct" && m.periodKey !== "",
  );
  const tv = new Map(reported.map((m) => [m.metricName, m]));
  const version = calculated[0]?.calculationVersion ?? "—";
  return (
    <div className="grid grid-2">
      <table data-testid="metrics-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">
              <EvidenceLabel kind="ARF_CALCULATED" />
            </th>
            <th className="num">
              <EvidenceLabel kind="TRADINGVIEW" />
            </th>
          </tr>
        </thead>
        <tbody>
          {ORDER.flatMap((name) => {
            const m = whole.find((x) => x.metricName === name);
            if (!m) return [];
            const t = tv.get(m.metricName);
            return [
              <tr key={name}>
                <td>
                  {name.replace(/_/g, " ")}{" "}
                  <span className="muted">({m.unit.toLowerCase().replace("_", " ")})</span>
                </td>
                <td className="num" title={m.undefinedReason ?? undefined}>
                  {formatMetric(m.value, m.unit, currency)}
                </td>
                <td className="num">
                  {t ? (
                    formatMetric(t.value, t.unit, currency)
                  ) : (
                    <span className="muted">not reported</span>
                  )}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <div>
        <h3>Monthly returns (UTC months, % of start-of-month closed equity)</h3>
        <table>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.periodKey}>
                <td className="mono">{m.periodKey}</td>
                <td className="num">{formatMetric(m.value, m.unit, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted mono">calculation {version}</p>
      </div>
    </div>
  );
}

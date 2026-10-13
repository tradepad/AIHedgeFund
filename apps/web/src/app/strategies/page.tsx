import Link from "next/link";
import { ParityStatusSchema, StrategyLibraryRowSchema, WorkflowStateSchema, pageOf } from "@arf/contracts";
import { EmptyState, ParityBadge, StaleNotice, StateBadge, formatDecimal } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";

export const dynamic = "force-dynamic";

const FILTERS = ["state", "parityStatus", "timeframe", "assetClass"] as const;

export default async function StrategyLibrary({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ limit: "50" });
  for (const f of FILTERS) {
    const v = sp[f];
    if (v) q.set(f, v);
  }
  if (sp.cursor) q.set("cursor", sp.cursor);
  const res = await apiGet(`/v1/strategy-library?${q.toString()}`, pageOf(StrategyLibraryRowSchema));
  const next = new URLSearchParams(q);
  next.delete("limit");
  return (
    <div className="stack">
      <h1>Strategy Library</h1>
      <form className="row card" method="get" aria-label="Filter strategies">
        <label>
          State
          <select name="state" defaultValue={sp.state ?? ""}>
            <option value="">Any</option>
            {WorkflowStateSchema.options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Parity
          <select name="parityStatus" defaultValue={sp.parityStatus ?? ""}>
            <option value="">Any</option>
            {ParityStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timeframe
          <input name="timeframe" defaultValue={sp.timeframe ?? ""} size={6} />
        </label>
        <label>
          Asset class
          <input name="assetClass" defaultValue={sp.assetClass ?? ""} size={10} />
        </label>
        <button type="submit" className="secondary">
          Apply
        </button>
      </form>
      {!res.ok ? (
        <ProblemView problem={res.problem} />
      ) : res.data.items.length === 0 ? (
        <EmptyState title="No strategy versions match" />
      ) : (
        <div className="card">
          <StaleNotice asOf={res.data.items[0]?.updatedAt ?? ""} />
          <table data-testid="library-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>State</th>
                <th>Market</th>
                <th>Parity</th>
                <th className="num">Trades</th>
                <th className="num">
                  Net profit <span className="evidence">ARF · simulated</span>
                </th>
                <th className="num">Max DD %</th>
                <th className="num">PF</th>
                <th>Decision</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((r) => (
                <tr key={r.strategyVersionId}>
                  <td>
                    <Link href={`/versions/${r.strategyVersionId}`}>
                      {r.strategyName} v{r.versionNumber}
                    </Link>
                    <div className="muted">{r.family}</div>
                  </td>
                  <td>
                    <StateBadge state={r.state} />
                  </td>
                  <td className="mono">
                    {r.symbol} · {r.timeframe}
                  </td>
                  <td>
                    <ParityBadge status={r.parityStatus} />
                  </td>
                  <td className="num">{r.closedTradeCount ?? "—"}</td>
                  <td className="num">{formatDecimal(r.netProfit)}</td>
                  <td className="num">{formatDecimal(r.maxDrawdownPct)}</td>
                  <td className="num">{formatDecimal(r.profitFactor, 3)}</td>
                  <td>{r.lastDecision ?? "—"}</td>
                  <td>
                    <Utc value={r.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {res.data.nextCursor ? <Link href={`/strategies?${new URLSearchParams({ ...Object.fromEntries(next), cursor: res.data.nextCursor }).toString()}`}>Next page →</Link> : null}
        </div>
      )}
    </div>
  );
}

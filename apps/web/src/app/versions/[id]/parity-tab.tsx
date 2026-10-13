import { ParityReportSchema, type StrategyVersion } from "@arf/contracts";
import { EmptyState, ParityBadge } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { latestRunId } from "./results-tab";

export async function ParityTab({ version }: { version: StrategyVersion }) {
  const latest = await latestRunId(version.id);
  if (!latest) return <EmptyState title="No verification yet" />;
  const res = await apiGet(
    `/v1/tradingview-verifications/${latest.verificationId}/parity`,
    ParityReportSchema,
  );
  if (!res.ok)
    return res.problem.status === 404 ? (
      <EmptyState title="Parity has not been calculated yet" />
    ) : (
      <ProblemView problem={res.problem} />
    );
  const p = res.data;
  return (
    <section className="card stack">
      <div className="row spread">
        <h2>
          Parity report <ParityBadge status={p.status} />
        </h2>
        <span className="mono muted">
          {p.policyVersion} · <Utc value={p.createdAt} />
        </span>
      </div>
      <p className="muted">
        TradingView-reported values compared with ARF&apos;s independent recomputation from the
        exported trade list. Identity is checked first, then the trade sequence, then aggregates.
      </p>
      {p.firstDivergence ? (
        <div
          className={`notice ${p.firstDivergence.status === "FAIL" ? "bad" : "warn"}`}
          data-testid="first-divergence"
        >
          <strong>First divergence: {p.firstDivergence.check}</strong> — {p.firstDivergence.detail}.
          Expected {p.firstDivergence.expected ?? "—"}, observed {p.firstDivergence.actual ?? "—"}.
        </div>
      ) : null}
      <table data-testid="parity-table">
        <thead>
          <tr>
            <th>Check</th>
            <th>Status</th>
            <th>TradingView / expected</th>
            <th>ARF / observed</th>
            <th>Tolerance</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {p.checks.map((c) => (
            <tr key={c.check}>
              <td className="mono">{c.check}</td>
              <td>
                <ParityBadge status={c.status} />
              </td>
              <td className="mono">{c.expected ?? "—"}</td>
              <td className="mono">{c.actual ?? "—"}</td>
              <td className="mono">{c.tolerance ?? "—"}</td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

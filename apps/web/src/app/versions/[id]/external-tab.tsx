import {
  ExternalEvidenceViewSchema,
  type ExternalResult,
  type ExternalVerdict,
  type StrategyVersion,
} from "@arf/contracts";
import { Badge, EmptyState, EvidenceLabel, formatDecimal, shortHash } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";

const VERDICT_TONE: Record<ExternalVerdict, "good" | "bad" | "warn" | "neutral"> = {
  PASS: "good",
  FAIL: "bad",
  INCONCLUSIVE: "warn",
  NOT_EVALUATED: "neutral",
};

const SEGMENT_TEXT: Record<ExternalResult["segment"], string> = {
  IN_SAMPLE: "In-sample",
  HOLDOUT: "Holdout",
  OUT_OF_SAMPLE: "Out-of-sample",
  FULL_HISTORY: "Full history",
  SUB_PERIOD: "Sub-period",
  AUTHOR_WINDOW: "Author's window",
};

const pct = (v: string | null) => (v === null ? "—" : `${formatDecimal(v, 1)}%`);

/**
 * Research done outside ARF-OS. Shown on its own tab, always labelled as
 * external, so it is never read as ARF-calculated or TradingView-verified.
 */
export async function ExternalTab({ version }: { version: StrategyVersion }) {
  const res = await apiGet(
    `/v1/strategy-versions/${version.id}/external-evidence`,
    ExternalEvidenceViewSchema,
  );
  if (!res.ok) return <ProblemView problem={res.problem} />;
  const { import: imp, results } = res.data;
  if (!imp)
    return (
      <EmptyState title="No external evidence">
        This version was created in ARF-OS. Its results appear on the results tab after a
        TradingView verification.
      </EmptyState>
    );
  return (
    <div className="stack" data-testid="external-evidence">
      <section className="card stack">
        <div className="row spread">
          <h2>Imported research</h2>
          <EvidenceLabel kind="EXTERNAL" />
        </div>
        <p className="muted">
          These numbers come from outside ARF-OS. They are not ARF-calculated, not
          TradingView-verified and do not count as workflow evidence. Treat them as a reason to
          test, not as proof.
        </p>
        <dl className="kv">
          <dt>Import batch</dt>
          <dd>
            {imp.batchTitle} <span className="mono muted">({imp.batchId})</span>
          </dd>
          <dt>Import key</dt>
          <dd className="mono">{imp.key}</dd>
          <dt>External strategy id</dt>
          <dd className="mono">{imp.externalStrategyId ?? "—"}</dd>
          <dt>Imported</dt>
          <dd>
            <Utc value={imp.importedAt} />
          </dd>
        </dl>
      </section>
      <section className="card">
        <h2>External results</h2>
        <table data-testid="external-results">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Window</th>
              <th>Source</th>
              <th>Trades</th>
              <th>Profit factor</th>
              <th>Max DD</th>
              <th>Net</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id}>
                <td>{SEGMENT_TEXT[r.segment]}</td>
                <td className="mono">
                  {r.windowFrom ?? "?"} → {r.windowTo ?? "?"}
                </td>
                <td>
                  {r.engine === "TRADER_DEV" ? "trader-dev" : "offline script"}
                  {r.provenance === "AUTHOR_REPORTED" ? (
                    <div className="muted">reported by author</div>
                  ) : null}
                  {r.externalResultId ? (
                    <div className="mono muted">{r.externalResultId}</div>
                  ) : null}
                </td>
                {r.runStatus === "NOT_RUN" ? (
                  <td colSpan={4} className="muted">
                    not run
                  </td>
                ) : (
                  <>
                    <td>{r.metrics.closedTradeCount ?? "—"}</td>
                    <td>{formatDecimal(r.metrics.profitFactor)}</td>
                    <td>{pct(r.metrics.maxDrawdownPct)}</td>
                    <td>{pct(r.metrics.netProfitPct)}</td>
                  </>
                )}
                <td>
                  <Badge tone={VERDICT_TONE[r.verdict]}>
                    {r.verdict.replace(/_/g, " ").toLowerCase()}
                  </Badge>
                  {r.verdictReasons.map((reason) => (
                    <div key={reason} className="muted">
                      {reason}
                    </div>
                  ))}
                  {r.notes.map((note) => (
                    <div key={note} className="muted">
                      {note}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {imp.source ? (
        <section className="card stack">
          <div className="row spread">
            <h2>Imported source ({imp.source.language.toLowerCase()}, read-only)</h2>
            <span className="mono muted">sha256 {shortHash(imp.source.sha256)}</span>
          </div>
          <p className="muted">
            Kept as found. It is not an ARF Pine revision and has not passed ARF static checks.
          </p>
          <pre className="code" data-testid="external-source">
            {imp.source.code}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

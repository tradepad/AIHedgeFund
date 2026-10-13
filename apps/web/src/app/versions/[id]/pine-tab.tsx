import { PineRevisionRecordSchema, type StrategyVersion } from "@arf/contracts";
import { Badge, EmptyState } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { apiGet } from "@/lib/server-api";
import { PineForm } from "./pine-form";

export async function PineTab({ version }: { version: StrategyVersion }) {
  const res = await apiGet(`/v1/strategy-versions/${version.id}/pine`, PineRevisionRecordSchema);
  if (res.ok) {
    const p = res.data;
    return (
      <div className="grid grid-2">
        <section className="card stack" style={{ gridColumn: "1 / -1" }}>
          <div className="row spread">
            <h2>Pine Script v{p.pineVersion} (read-only)</h2>
            <div className="row">
              <Badge
                tone={p.lintStatus === "PASS" ? "good" : p.lintStatus === "WARN" ? "warn" : "bad"}
              >
                lint {p.lintStatus.toLowerCase()}
              </Badge>
              <a href={`/arf-api/v1/artefacts/${p.artefactId}/content`}>Download source</a>
            </div>
          </div>
          <div className="mono muted">source sha256 {p.sourceHash}</div>
          <p className="muted">
            Load exactly this source in TradingView. The verification upload asks you to attest this
            hash.
          </p>
          <pre className="code" data-testid="pine-source">
            {p.source}
          </pre>
        </section>
        <section className="card">
          <h2>Static checks ({p.lint.linterVersion})</h2>
          {p.lint.findings.length === 0 ? (
            <EmptyState title="No findings" />
          ) : (
            <table>
              <tbody>
                {p.lint.findings.map((f, i) => (
                  <tr key={`${f.rule}-${i}`}>
                    <td>
                      <Badge tone={f.severity === "ERROR" ? "bad" : "warn"}>
                        {f.severity.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="mono">{f.rule}</td>
                    <td>{f.message}</td>
                    <td className="mono">{f.line ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Manifest</h2>
          <pre className="code">{JSON.stringify(p.manifest, null, 2)}</pre>
        </section>
      </div>
    );
  }
  if (res.problem.status !== 404) return <ProblemView problem={res.problem} />;
  if (version.state !== "PINE_DEVELOPMENT")
    return (
      <EmptyState title="No Pine revision attached">
        Pine is attached during PINE_DEVELOPMENT, after the Strategy Definition.
      </EmptyState>
    );
  return <PineForm versionId={version.id} />;
}

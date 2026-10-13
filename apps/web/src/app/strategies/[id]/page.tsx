import Link from "next/link";
import { StrategyWithVersionsSchema } from "@arf/contracts";
import { EmptyState, StateBadge, shortHash } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { CreateVersion } from "./create-version";

export const dynamic = "force-dynamic";

export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiGet(`/v1/strategies/${id}`, StrategyWithVersionsSchema);
  if (!res.ok) return <ProblemView problem={res.problem} />;
  const { strategy, versions } = res.data;
  return (
    <div className="stack">
      <div>
        <div className="muted">
          Strategy · <Link href={`/campaigns/${strategy.campaignId}`}>campaign</Link>
        </div>
        <h1>{strategy.name}</h1>
        <div className="muted">{strategy.family}</div>
      </div>
      <div className="grid grid-2">
        <section className="card">
          <h2>Immutable versions</h2>
          {versions.length === 0 ? (
            <EmptyState title="No versions yet">Create the root version to attach a definition and Pine source.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>State</th>
                  <th>Market</th>
                  <th>Pine</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/versions/${v.id}`} data-testid="version-link">
                        v{v.versionNumber}
                      </Link>
                      {v.parentVersionId ? <span className="muted"> (child)</span> : null}
                    </td>
                    <td>
                      <StateBadge state={v.state} />
                    </td>
                    <td className="mono">
                      {v.symbol} · {v.timeframe}
                    </td>
                    <td className="mono">{shortHash(v.pineSourceHash)}</td>
                    <td>
                      <Utc value={v.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <CreateVersion strategyId={strategy.id} parents={versions.map((v) => ({ id: v.id, label: `v${v.versionNumber}`, symbol: v.symbol, timeframe: v.timeframe }))} />
      </div>
    </div>
  );
}

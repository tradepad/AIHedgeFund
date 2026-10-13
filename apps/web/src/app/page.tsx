import Link from "next/link";
import { CommandCentreViewSchema, WorkflowStateSchema } from "@arf/contracts";
import { EmptyState, ParityBadge, StateBadge } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function CommandCentre() {
  const res = await apiGet("/v1/command-centre", CommandCentreViewSchema);
  if (!res.ok) return <ProblemView problem={res.problem} />;
  const v = res.data;
  return (
    <div className="stack">
      <div className="row spread">
        <div>
          <h1>Command Centre</h1>
          <div className="muted">
            As of <Utc value={v.generatedAt} />
          </div>
        </div>
        <Link className="button" href="/campaigns">
          New campaign
        </Link>
      </div>

      <section className="grid grid-4" aria-label="Pipeline counts">
        <div className="card">
          <h3>Active campaigns</h3>
          <div className="stat">{v.activeCampaigns}</div>
        </div>
        {WorkflowStateSchema.options
          .filter((s) => s !== "CAMPAIGN_BACKLOG" && s !== "IDEA_RESEARCH")
          .map((s) => (
            <div className="card" key={s}>
              <h3>
                <StateBadge state={s} />
              </h3>
              <div className="stat" data-testid={`count-${s}`}>
                {v.versionCountsByState[s] ?? 0}
              </div>
            </div>
          ))}
      </section>

      <section className="grid grid-2">
        <div className="card">
          <h2>Awaiting committee decision</h2>
          {v.awaitingDecision.length === 0 ? (
            <EmptyState title="Nothing awaiting a decision" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Parity</th>
                  <th className="num">Trades</th>
                </tr>
              </thead>
              <tbody>
                {v.awaitingDecision.map((r) => (
                  <tr key={r.strategyVersionId}>
                    <td>
                      <Link href={`/versions/${r.strategyVersionId}/decision`}>
                        {r.strategyName} v{r.versionNumber}
                      </Link>
                    </td>
                    <td>
                      <ParityBadge status={r.parityStatus} />
                    </td>
                    <td className="num">{r.closedTradeCount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Open TradingView verifications</h2>
          {v.openVerifications.length === 0 ? (
            <EmptyState title="No open verifications" />
          ) : (
            <table>
              <tbody>
                {v.openVerifications.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link href={`/verifications/${x.id}`}>{x.id.slice(0, 13)}…</Link>
                    </td>
                    <td>
                      <span
                        className={`badge ${x.status === "PARSE_FAILED" ? "tone-bad" : "tone-warn"}`}
                      >
                        {x.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <Utc value={x.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Failed jobs (7 days)</h2>
          {v.failedJobs.length === 0 ? (
            <EmptyState title="No failed jobs" />
          ) : (
            <table>
              <tbody>
                {v.failedJobs.map((j) => (
                  <tr key={j.jobKey}>
                    <td className="mono">{j.jobName}</td>
                    <td>
                      <span className="badge tone-bad">{j.lastErrorCode ?? j.status}</span>
                    </td>
                    <td>
                      {j.verificationId ? (
                        <Link href={`/verifications/${j.verificationId}`}>verification</Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Recent activity</h2>
          {v.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <table>
              <tbody>
                {v.recentActivity.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.action}</td>
                    <td className="muted">{e.actorType === "USER" ? "user" : e.actorId}</td>
                    <td>
                      <Utc value={e.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import { z } from "zod";
import {
  CampaignSummarySchema,
  IdeaCardRecordSchema,
  ResearchTaskSchema,
  StrategyLibraryRowSchema,
  exampleIdeaCard,
  pageOf,
} from "@arf/contracts";
import { EmptyState, ParityBadge, StateBadge } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { CampaignActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summary = await apiGet(`/v1/campaigns/${id}`, CampaignSummarySchema);
  if (!summary.ok) return <ProblemView problem={summary.problem} />;
  const [tasks, ideas, strategies] = await Promise.all([
    apiGet(`/v1/campaigns/${id}/tasks`, z.object({ items: z.array(ResearchTaskSchema) })),
    apiGet(`/v1/campaigns/${id}/ideas`, z.object({ items: z.array(IdeaCardRecordSchema) })),
    apiGet(`/v1/strategy-library?campaignId=${id}&limit=100`, pageOf(StrategyLibraryRowSchema)),
  ]);
  const c = summary.data;
  return (
    <div className="stack">
      <div>
        <div className="muted">Campaign</div>
        <h1 data-testid="campaign-name">{c.name}</h1>
        <p>{c.objective}</p>
        <div className="row muted">
          <span>{c.assetClasses.join(", ")}</span>
          <span>timeframes {c.timeframes.join(", ")}</span>
          <span>{c.strategyCount} strategies</span>
          <Link href={`/campaigns/${id}/audit`}>Audit history</Link>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Strategies</h2>
          {!strategies.ok ? (
            <ProblemView problem={strategies.problem} />
          ) : strategies.data.items.length === 0 ? (
            <EmptyState title="No strategies yet" />
          ) : (
            <table>
              <tbody>
                {strategies.data.items.map((r) => (
                  <tr key={r.strategyVersionId}>
                    <td>
                      <Link href={`/versions/${r.strategyVersionId}`}>
                        {r.strategyName} v{r.versionNumber}
                      </Link>
                    </td>
                    <td>
                      <StateBadge state={r.state} />
                    </td>
                    <td>
                      <ParityBadge status={r.parityStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Research tasks</h2>
          {!tasks.ok ? (
            <ProblemView problem={tasks.problem} />
          ) : tasks.data.items.length === 0 ? (
            <EmptyState title="No research tasks yet" />
          ) : (
            <table>
              <tbody>
                {tasks.data.items.map((t) => (
                  <tr key={t.id} data-testid="task-row">
                    <td>{t.title}</td>
                    <td className="mono">{t.role}</td>
                    <td>
                      <StateBadge state={t.state} />
                    </td>
                    <td>
                      <Utc value={t.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Idea Cards</h2>
        {!ideas.ok ? (
          <ProblemView problem={ideas.problem} />
        ) : ideas.data.items.length === 0 ? (
          <EmptyState title="No ideas yet" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Feasibility</th>
                <th>Evidence</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {ideas.data.items.map((i) => (
                <tr key={i.id} data-testid="idea-row">
                  <td>
                    <strong>{i.ideaCard.title}</strong>
                    {/* Model text is rendered as plain text, never as HTML or markdown. */}
                    <div className="muted">{i.ideaCard.hypothesis}</div>
                  </td>
                  <td>
                    {i.agentRunId ? (
                      <span className="badge tone-info">IDEA_SCOUT model</span>
                    ) : (
                      <span className="badge">human</span>
                    )}
                  </td>
                  <td>{i.ideaCard.pineFeasibility}</td>
                  <td>{i.ideaCard.evidenceStrength}</td>
                  <td>{i.ideaCard.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CampaignActions
        campaignId={id}
        ideas={ideas.ok ? ideas.data.items.map((i) => ({ id: i.id, title: i.ideaCard.title })) : []}
        ideaTemplate={JSON.stringify(exampleIdeaCard, null, 2)}
      />
    </div>
  );
}

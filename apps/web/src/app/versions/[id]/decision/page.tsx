import Link from "next/link";
import { DecisionContextSchema, StrategyVersionSchema } from "@arf/contracts";
import { ParityBadge, StateBadge, shortHash } from "@arf/ui";
import { EvidenceSummary } from "@/components/evidence-summary";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { DecisionForm } from "./decision-form";

export const dynamic = "force-dynamic";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [version, context] = await Promise.all([
    apiGet(`/v1/strategy-versions/${id}`, StrategyVersionSchema),
    apiGet(`/v1/strategy-versions/${id}/decision-context`, DecisionContextSchema),
  ]);
  if (!version.ok) return <ProblemView problem={version.problem} />;
  if (!context.ok) return <ProblemView problem={context.problem} />;
  const v = version.data;
  const { evidence, overridableWarnings, decision } = context.data;
  return (
    <div className="stack">
      <div>
        <div className="muted">
          <Link href={`/versions/${v.id}`}>← back to version</Link>
        </div>
        <h1>
          Committee decision: {v.strategyName} v{v.versionNumber} <StateBadge state={v.state} />
        </h1>
      </div>
      <div className="grid grid-2">
        <section className="card">
          <h2>Exact version under decision</h2>
          <dl className="kv" data-testid="decision-version">
            <dt>Version id</dt>
            <dd className="mono">{v.id}</dd>
            <dt>Symbol / timeframe</dt>
            <dd className="mono">
              {v.symbol} · {v.timeframe}
            </dd>
            <dt>Definition hash</dt>
            <dd className="mono">
              {evidence.definitionHash ? shortHash(evidence.definitionHash) : "missing"}
            </dd>
            <dt>Pine source hash</dt>
            <dd className="mono">{evidence.pineSourceHash ?? "missing"}</dd>
            <dt>Manifest hash</dt>
            <dd className="mono">
              {evidence.manifestHash ? shortHash(evidence.manifestHash) : "missing"}
            </dd>
            <dt>Parity</dt>
            <dd>
              <ParityBadge status={evidence.parityStatus} />{" "}
              {evidence.parityReportId ? (
                <span className="mono muted">{shortHash(evidence.parityReportId)}</span>
              ) : null}
            </dd>
          </dl>
          <p className="muted">
            Evidence is assembled by the API from canonical records at decision time. Validator
            recommendation: no validator agent runs in this slice, so the parity report and ARF
            metrics are the validation evidence.
          </p>
        </section>
        <section className="card">
          <h2>Mandatory evidence</h2>
          <EvidenceSummary evidence={evidence} />
        </section>
      </div>
      {decision ? (
        <section className="card" data-testid="recorded-decision">
          <h2>Decision recorded: {decision.decision.replace(/_/g, " ")}</h2>
          <dl className="kv">
            <dt>Decided by</dt>
            <dd className="mono">{decision.decidedBy}</dd>
            <dt>At</dt>
            <dd>
              <Utc value={decision.createdAt} />
            </dd>
            <dt>Reason codes</dt>
            <dd className="mono">{decision.reasonCodes.join(", ")}</dd>
            <dt>Summary</dt>
            <dd>{decision.summary}</dd>
            <dt>Strongest rejection case</dt>
            <dd>{decision.rejectionCase}</dd>
            <dt>Human override</dt>
            <dd>{decision.humanOverride ? `yes: ${decision.overrideReason ?? ""}` : "no"}</dd>
            <dt>Policy</dt>
            <dd className="mono">{decision.policyVersion}</dd>
          </dl>
        </section>
      ) : v.state !== "PAPER_APPROVAL_REVIEW" ? (
        <section className="card">
          <p>
            Decisions are recorded in the paper-approval review state. This version is in{" "}
            <StateBadge state={v.state} />.
          </p>
        </section>
      ) : (
        <DecisionForm
          versionId={v.id}
          parityReportId={evidence.parityReportId}
          canApprove={evidence.hardFailures.length === 0 && evidence.missingEvidence.length === 0}
          overridableWarnings={overridableWarnings}
        />
      )}
    </div>
  );
}

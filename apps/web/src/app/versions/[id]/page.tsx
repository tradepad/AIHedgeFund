import Link from "next/link";
import { z } from "zod";
import {
  AuditEventSchema,
  DecisionContextSchema,
  LineageNodeSchema,
  StrategyVersionSchema,
  TransitionRecordSchema,
  VerificationSchema,
  pageOf,
  type StrategyVersion,
} from "@arf/contracts";
import { StateBadge, shortHash } from "@arf/ui";
import { AuditTable } from "@/components/audit-table";
import { EvidenceSummary } from "@/components/evidence-summary";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { DefinitionTab } from "./definition-tab";
import { PineTab } from "./pine-tab";
import { ResultsTab } from "./results-tab";
import { ParityTab } from "./parity-tab";
import { TransitionButton } from "./transition-button";
import { VerificationTab } from "./verification-tab";

export const dynamic = "force-dynamic";

const TABS = [
  "overview",
  "definition",
  "pine",
  "verification",
  "results",
  "parity",
  "lineage",
  "audit",
] as const;
type Tab = (typeof TABS)[number];

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "overview";
  const res = await apiGet(`/v1/strategy-versions/${id}`, StrategyVersionSchema);
  if (!res.ok) return <ProblemView problem={res.problem} />;
  const v = res.data;
  return (
    <div className="stack">
      <div className="row spread">
        <div>
          <div className="muted">
            <Link href={`/strategies/${v.strategyId}`}>{v.strategyName}</Link> · version{" "}
            {v.versionNumber}
            {v.lockedAt ? " · locked for testing" : ""}
          </div>
          <h1>
            {v.strategyName} v{v.versionNumber} <StateBadge state={v.state} />
          </h1>
          <div className="mono muted">
            {v.symbol} · {v.timeframe} · {v.id}
          </div>
        </div>
        {v.state === "PAPER_APPROVAL_REVIEW" ? (
          <Link className="button" href={`/versions/${v.id}/decision`}>
            Open decision
          </Link>
        ) : null}
      </div>
      <nav className="tabs" aria-label="Strategy version sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/versions/${id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            data-testid={`tab-${t}`}
          >
            {t}
          </Link>
        ))}
      </nav>
      {await renderTab(tab, v, sp.cursor)}
    </div>
  );
}

async function renderTab(tab: Tab, v: StrategyVersion, cursor: string | undefined) {
  switch (tab) {
    case "overview":
      return <Overview v={v} />;
    case "definition":
      return <DefinitionTab version={v} />;
    case "pine":
      return <PineTab version={v} />;
    case "verification":
      return <VerificationTab version={v} />;
    case "results":
      return <ResultsTab version={v} cursor={cursor} />;
    case "parity":
      return <ParityTab version={v} />;
    case "lineage":
      return <Lineage id={v.id} />;
    case "audit": {
      const res = await apiGet(
        `/v1/strategy-versions/${v.id}/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        pageOf(AuditEventSchema),
      );
      if (!res.ok) return <ProblemView problem={res.problem} />;
      return (
        <AuditTable
          events={res.data.items}
          nextHref={
            res.data.nextCursor
              ? `/versions/${v.id}?tab=audit&cursor=${encodeURIComponent(res.data.nextCursor)}`
              : null
          }
        />
      );
    }
  }
}

async function Overview({ v }: { v: StrategyVersion }) {
  const [context, transitions, verifications] = await Promise.all([
    apiGet(`/v1/strategy-versions/${v.id}/decision-context`, DecisionContextSchema),
    apiGet(
      `/v1/strategy-versions/${v.id}/transitions`,
      z.object({ items: z.array(TransitionRecordSchema) }),
    ),
    apiGet(
      `/v1/strategy-versions/${v.id}/verifications`,
      z.object({ items: z.array(VerificationSchema) }),
    ),
  ]);
  return (
    <div className="grid grid-2">
      <section className="card stack">
        <h2>Identity</h2>
        <dl className="kv">
          <dt>Parent</dt>
          <dd>
            {v.parentVersionId ? (
              <Link href={`/versions/${v.parentVersionId}`}>{v.parentVersionId}</Link>
            ) : (
              "root version"
            )}
          </dd>
          <dt>Change reason</dt>
          <dd>{v.changeReason}</dd>
          <dt>SDL hash</dt>
          <dd className="mono">{shortHash(v.definitionHash)}</dd>
          <dt>Pine source hash</dt>
          <dd className="mono" data-testid="pine-hash">
            {v.pineSourceHash ?? "—"}
          </dd>
          <dt>Manifest hash</dt>
          <dd className="mono">{shortHash(v.manifestHash)}</dd>
          <dt>Created</dt>
          <dd>
            <Utc value={v.createdAt} />
          </dd>
        </dl>
        <NextStep
          v={v}
          verificationIds={verifications.ok ? verifications.data.items.map((x) => x.id) : []}
        />
      </section>
      <section className="card stack">
        <h2>Evidence status</h2>
        {context.ok ? (
          <EvidenceSummary evidence={context.data.evidence} />
        ) : (
          <ProblemView problem={context.problem} />
        )}
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Lifecycle transitions</h2>
        {!transitions.ok ? (
          <ProblemView problem={transitions.problem} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>From → to</th>
                <th>Actor</th>
                <th>Reason</th>
                <th>Policy</th>
              </tr>
            </thead>
            <tbody>
              {transitions.data.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Utc value={t.createdAt} />
                  </td>
                  <td>
                    <StateBadge state={t.fromState} /> → <StateBadge state={t.toState} />
                    {t.humanOverride ? (
                      <span className="badge tone-warn">human override</span>
                    ) : null}
                  </td>
                  <td className="mono">
                    {t.actorType === "USER" ? `user ${t.actorId.slice(0, 8)}` : t.actorId}
                  </td>
                  <td>{t.summary}</td>
                  <td className="mono">{t.policyVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function NextStep({ v, verificationIds }: { v: StrategyVersion; verificationIds: string[] }) {
  switch (v.state) {
    case "HYPOTHESIS_DRAFT":
      return v.definitionHash ? (
        <TransitionButton
          versionId={v.id}
          to="PINE_DEVELOPMENT"
          label="Start Pine development"
          reasonCode="SDL_COMPLETE"
          summary="Strategy definition attached"
        />
      ) : (
        <p className="muted">
          Next: <Link href={`/versions/${v.id}?tab=definition`}>attach a Strategy Definition</Link>.
        </p>
      );
    case "PINE_DEVELOPMENT":
      return v.pineSourceHash ? (
        <TransitionButton
          versionId={v.id}
          to="TRADINGVIEW_VERIFICATION"
          label="Request TradingView verification"
          reasonCode="PINE_READY"
          summary="Pine revision passed static checks"
        />
      ) : (
        <p className="muted">
          Next: <Link href={`/versions/${v.id}?tab=pine`}>attach a Pine v6 revision</Link>.
        </p>
      );
    case "TRADINGVIEW_VERIFICATION":
      return (
        <div className="stack">
          <p className="muted">
            {verificationIds.length === 0 ? (
              <>
                Next:{" "}
                <Link href={`/versions/${v.id}?tab=verification`}>
                  create a TradingView verification
                </Link>
                .
              </>
            ) : (
              <>
                Verification in progress:{" "}
                <Link href={`/verifications/${verificationIds[0] ?? ""}`}>upload exports</Link>.
              </>
            )}
          </p>
          <TransitionButton
            versionId={v.id}
            to="PAPER_APPROVAL_REVIEW"
            label="Submit for paper approval review"
            reasonCode="VERIFICATION_COMPLETE"
            summary="Verification and parity complete"
            secondary
          />
        </div>
      );
    case "PAPER_APPROVAL_REVIEW":
      return <p className="muted">Awaiting an independent committee decision.</p>;
    case "PAPER_APPROVED":
    case "REJECTED":
      return <p className="muted">Terminal state. Further work requires a child version.</p>;
    case "BLOCKED":
    case "CAMPAIGN_BACKLOG":
    case "IDEA_RESEARCH":
      return null;
  }
}

async function Lineage({ id }: { id: string }) {
  const res = await apiGet(
    `/v1/strategy-versions/${id}/lineage`,
    z.object({ items: z.array(LineageNodeSchema) }),
  );
  if (!res.ok) return <ProblemView problem={res.problem} />;
  return (
    <div className="card">
      <table data-testid="lineage-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>State</th>
            <th>Change</th>
            <th>Contaminated data</th>
            <th>Hashes (SDL / Pine)</th>
          </tr>
        </thead>
        <tbody>
          {res.data.items.map((n) => (
            <tr key={n.versionId}>
              <td>
                <Link href={`/versions/${n.versionId}`}>v{n.versionNumber}</Link>
                {n.versionId === id ? <span className="muted"> (this)</span> : null}
              </td>
              <td>
                <StateBadge state={n.state} />
              </td>
              <td>
                {n.changeReason}
                {n.changeCategories.length > 0 ? (
                  <div className="muted">
                    {n.changeCategories.join(", ")}: {n.changedFields.join(", ")}
                  </div>
                ) : null}
              </td>
              <td>
                {n.contaminatedData.length > 0 ? (
                  n.contaminatedData.join(", ")
                ) : (
                  <span className="muted">none declared</span>
                )}
              </td>
              <td className="mono">
                {shortHash(n.definitionHash)} / {shortHash(n.pineSourceHash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

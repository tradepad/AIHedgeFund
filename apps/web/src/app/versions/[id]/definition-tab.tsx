import {
  StrategyDefinitionRecordSchema,
  exampleStrategyDefinition,
  type StrategyVersion,
} from "@arf/contracts";
import { EmptyState, shortHash } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { apiGet } from "@/lib/server-api";
import { DefinitionForm } from "./definition-form";

export async function DefinitionTab({ version }: { version: StrategyVersion }) {
  const res = await apiGet(
    `/v1/strategy-versions/${version.id}/definition`,
    StrategyDefinitionRecordSchema,
  );
  if (res.ok) {
    return (
      <section className="card stack">
        <div className="row spread">
          <h2>Strategy Definition (read-only)</h2>
          <span className="mono muted">sha256 {shortHash(res.data.contentHash)}</span>
        </div>
        <pre className="code" data-testid="sdl-json">
          {JSON.stringify(res.data.definition, null, 2)}
        </pre>
      </section>
    );
  }
  if (res.problem.status !== 404) return <ProblemView problem={res.problem} />;
  if (version.state !== "HYPOTHESIS_DRAFT")
    return <EmptyState title="No Strategy Definition was attached to this version" />;
  const template = {
    ...exampleStrategyDefinition,
    market: {
      ...exampleStrategyDefinition.market,
      symbols: [version.symbol],
      timeframe: version.timeframe,
    },
  };
  return <DefinitionForm versionId={version.id} template={JSON.stringify(template, null, 2)} />;
}

"use client";

import { field } from "@/lib/form";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DecisionSchema, type DecisionType } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";

const REASONS: Record<DecisionType, string> = {
  REJECT: "EVIDENCE_INSUFFICIENT",
  REWORK_WITH_NEW_VERSION: "REWORK_REQUIRED",
  PAPER_APPROVED: "EVIDENCE_SUFFICIENT_FOR_PAPER",
};

export function DecisionForm({ versionId, parityReportId, canApprove, overridableWarnings }: { versionId: string; parityReportId: string | null; canApprove: boolean; overridableWarnings: string[] }) {
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionType>("REJECT");
  const [override, setOverride] = useState(false);
  const { run, pending, problem } = useCommand("POST", DecisionSchema);
  const needsOverride = decision === "PAPER_APPROVED" && overridableWarnings.length > 0;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const codes = field(f, "reasonCodes")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const overrideReason = field(f, "overrideReason").trim();
    const recorded = await run("/v1/committee/decisions", {
      strategyVersionId: versionId,
      decision,
      reasonCodes: codes,
      summary: field(f, "summary"),
      rejectionCase: field(f, "rejectionCase"),
      parityReportId,
      humanOverride: needsOverride && override,
      ...(needsOverride && override ? { overrideReason } : {}),
      acknowledgement: f.get("acknowledgement") === "on",
    });
    if (recorded) router.refresh();
  }

  return (
    <form className="card stack" onSubmit={(e) => void onSubmit(e)} aria-label="Record decision">
      <h2>Record decision</h2>
      <fieldset className="row" style={{ border: 0, padding: 0 }}>
        <legend className="muted">Decision</legend>
        {(["REJECT", "REWORK_WITH_NEW_VERSION", "PAPER_APPROVED"] as const).map((d) => (
          <label key={d} className="inline">
            <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} disabled={d === "PAPER_APPROVED" && !canApprove} data-testid={`decision-${d}`} />
            {d.replace(/_/g, " ").toLowerCase()}
          </label>
        ))}
      </fieldset>
      {!canApprove ? <div className="notice bad">Paper approval is unavailable: mandatory evidence is missing or a hard failure is present.</div> : null}
      <label>
        Reason codes (comma separated, UPPER_SNAKE)
        <input name="reasonCodes" key={decision} defaultValue={REASONS[decision]} required />
      </label>
      <label>
        Decision summary
        <textarea name="summary" rows={3} required minLength={10} data-testid="decision-summary" />
      </label>
      <label>
        Strongest case for rejection (required for every decision)
        <textarea name="rejectionCase" rows={3} required minLength={10} data-testid="decision-rejection-case" />
      </label>
      {needsOverride ? (
        <div className="notice warn stack">
          <div>Approving with these warnings requires an explicit, audited human override: {overridableWarnings.join(", ")}.</div>
          <label className="inline">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} data-testid="decision-override" /> I am overriding these warnings
          </label>
          {override ? (
            <label>
              Override reason
              <textarea name="overrideReason" rows={2} required minLength={10} data-testid="decision-override-reason" />
            </label>
          ) : null}
        </div>
      ) : null}
      <label className="inline">
        <input type="checkbox" name="acknowledgement" required data-testid="decision-ack" /> I reviewed the exact version, the mandatory evidence and the hard failures above. A backtest is not a guarantee.
      </label>
      <ProblemInline problem={problem} />
      <div>
        <button type="submit" disabled={pending} data-testid="decision-submit">
          Record decision
        </button>
      </div>
    </form>
  );
}

import type { ReactNode } from "react";
import type { ParityStatus, WorkflowState } from "@arf/contracts";

/**
 * Evidence labels (CLAUDE.md §18.1). Every number shown in the UI carries
 * where it came from and what kind of evidence it is.
 */
export type EvidenceKind =
  | "IN_SAMPLE"
  | "VALIDATION"
  | "FINAL_HOLDOUT"
  | "FORWARD"
  | "GROSS"
  | "NET"
  | "SIMULATED"
  | "PAPER"
  | "TRADINGVIEW"
  | "ARF_CALCULATED"
  | "LOCAL_RUNNER"
  | "EXTERNAL";

const EVIDENCE_TEXT: Record<EvidenceKind, string> = {
  IN_SAMPLE: "In-sample",
  VALIDATION: "Validation",
  FINAL_HOLDOUT: "Final holdout",
  FORWARD: "Forward",
  GROSS: "Gross",
  NET: "Net",
  SIMULATED: "Historical · simulated",
  PAPER: "Paper",
  TRADINGVIEW: "TradingView reported",
  ARF_CALCULATED: "ARF calculated",
  LOCAL_RUNNER: "Local runner",
  EXTERNAL: "External · not ARF-verified",
};

export function EvidenceLabel({ kind }: { kind: EvidenceKind }) {
  return (
    <span className={`evidence evidence-${kind.toLowerCase()}`} data-evidence={kind}>
      {EVIDENCE_TEXT[kind]}
    </span>
  );
}

const STATE_TONE: Record<WorkflowState, "neutral" | "info" | "warn" | "good" | "bad"> = {
  CAMPAIGN_BACKLOG: "neutral",
  IDEA_RESEARCH: "info",
  HYPOTHESIS_DRAFT: "info",
  PINE_DEVELOPMENT: "info",
  TRADINGVIEW_VERIFICATION: "warn",
  PAPER_APPROVAL_REVIEW: "warn",
  PAPER_APPROVED: "good",
  REJECTED: "bad",
  BLOCKED: "bad",
};

export function StateBadge({ state }: { state: WorkflowState }) {
  return (
    <span className={`badge tone-${STATE_TONE[state]}`} data-state={state}>
      {state.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

const PARITY_TONE: Record<ParityStatus, "good" | "warn" | "bad" | "neutral"> = {
  PASS: "good",
  WARN: "warn",
  FAIL: "bad",
  INSUFFICIENT_DATA: "neutral",
};

export function ParityBadge({ status }: { status: ParityStatus | null }) {
  if (!status) return <span className="badge tone-neutral">no parity report</span>;
  return (
    <span className={`badge tone-${PARITY_TONE[status]}`} data-parity={status}>
      parity {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "info" | "warn" | "good" | "bad";
  children: ReactNode;
}) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

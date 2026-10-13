import type { EvidenceSnapshot } from "@arf/contracts";
import { ParityBadge } from "@arf/ui";

const LABELS: Record<string, string> = {
  STRATEGY_DEFINITION: "Strategy Definition",
  PINE_REVISION: "Pine revision",
  TRADINGVIEW_VERIFICATION: "TradingView verification",
  VERIFICATION_COMPLETED: "Completed verification",
  BACKTEST_RUN: "Backtest run",
  METRICS: "ARF metrics",
  PARITY_REPORT: "Parity report",
  PARITY_CONCLUSIVE: "Conclusive parity (not insufficient data)",
  PARITY_FAIL: "Parity FAIL",
  PINE_LINT_FAIL: "Pine lint hard errors",
  REPORT_PARSE_FAILED: "Report parse failure",
  PARITY_WARN: "Parity WARN",
  LOW_TRADE_COUNT: "Fewer than 100 closed trades",
  PINE_LINT_WARNINGS: "Pine lint warnings",
  PARSER_WARNINGS: "Parser warnings",
};

const label = (code: string): string => LABELS[code] ?? code;

/** Mandatory evidence, hard failures and warnings, computed by the API from canonical records. */
export function EvidenceSummary({ evidence }: { evidence: EvidenceSnapshot }) {
  return (
    <div className="stack" data-testid="evidence-summary">
      <div className="row">
        <ParityBadge status={evidence.parityStatus} />
        <span className="badge">{evidence.closedTradeCount ?? "—"} closed trades</span>
      </div>
      <div>
        <h3>Hard failures</h3>
        {evidence.hardFailures.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul data-testid="hard-failures">
            {evidence.hardFailures.map((h) => (
              <li key={h} className="tone-bad">
                {label(h)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3>Missing evidence</h3>
        {evidence.missingEvidence.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul>
            {evidence.missingEvidence.map((m) => (
              <li key={m}>{label(m)}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3>Warnings</h3>
        {evidence.warnings.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul>
            {evidence.warnings.map((w) => (
              <li key={w} className="tone-warn">
                {label(w)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

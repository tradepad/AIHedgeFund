"use client";

import type { ProblemDetails } from "@arf/contracts";

export function ProblemInline({ problem }: { problem: ProblemDetails | null }) {
  if (!problem) return null;
  return (
    <div className="notice bad" role="alert" data-testid="problem">
      <strong>{problem.code}</strong>: {problem.detail}
      {problem.errors && problem.errors.length > 0 ? (
        <ul>
          {problem.errors.slice(0, 8).map((e) => (
            <li key={`${e.path}-${e.message}`} className="mono">
              {e.path || "(root)"}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      {problem.traceId ? <div className="muted mono">trace {problem.traceId}</div> : null}
    </div>
  );
}

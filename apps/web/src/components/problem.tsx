import type { ProblemDetails } from "@arf/contracts";
import { ErrorState } from "@arf/ui";

export function ProblemView({ problem }: { problem: ProblemDetails }) {
  const title = problem.status === 404 ? "Not found" : problem.status === 403 ? "Not allowed" : problem.status === 401 ? "Signed out" : "Could not load";
  return <ErrorState title={title} detail={`${problem.detail} (${problem.code})`} traceId={problem.traceId || null} />;
}

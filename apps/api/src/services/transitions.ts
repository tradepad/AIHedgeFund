import { and, asc, eq } from "drizzle-orm";
import type { TransitionRequest, WorkflowState } from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { stateTransitions, strategyVersions, type Tx } from "@arf/db";
import type { TransitionRejection, TransitionSuccess, WorkflowAggregate } from "@arf/workflow";
import type { AppContext, RequestScope } from "../context";
import { problems, type ProblemError } from "../http/problem";
import { iso } from "./common";
import { computeEvidence } from "./evidence";

export function rejectionToProblem(rejection: TransitionRejection): ProblemError {
  switch (rejection.code) {
    case "ACTOR_TYPE_NOT_ALLOWED":
    case "ROLE_NOT_ALLOWED":
    case "SEPARATION_OF_DUTIES":
      return problems.forbidden(rejection.code, rejection.detail);
    case "STALE_STATE":
    case "TERMINAL_STATE":
    case "IDEMPOTENCY_CONFLICT":
      return problems.conflict(rejection.code, rejection.detail);
    case "NOT_FOUND":
      return problems.notFound("workflow aggregate");
    case "TRANSITION_NOT_ALLOWED":
    case "EVIDENCE_MISSING":
    case "EVIDENCE_NOT_FOUND":
    case "HARD_FAIL":
      return problems.unprocessable(rejection.code, rejection.detail);
  }
}

/** Apply a transition as the requesting user inside the caller's transaction; policy rejection rolls the command back. */
export async function applyTransition(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  input: {
    aggregate: WorkflowAggregate;
    aggregateId: string;
    from: WorkflowState;
    to: WorkflowState;
    reasonCodes: string[];
    summary: string;
    evidenceIds: string[];
    key: string;
    humanOverride?: boolean;
    overrideReason?: string | null;
  },
): Promise<TransitionSuccess> {
  const result = await ctx.workflow.transition(tx, {
    organisationId: scope.principal.organisationId,
    aggregate: input.aggregate,
    aggregateId: input.aggregateId,
    from: input.from,
    to: input.to,
    actor: { type: "USER", id: scope.principal.userId, roles: scope.principal.roles },
    reasonCodes: input.reasonCodes,
    summary: input.summary,
    evidenceIds: input.evidenceIds,
    transitionKey: sha256Hex(`${input.aggregateId}|${input.from}|${input.to}|${scope.principal.userId}|${input.key}`),
    traceId: scope.traceId,
    correlationId: scope.correlationId,
    humanOverride: input.humanOverride ?? false,
    overrideReason: input.overrideReason ?? null,
  });
  if (!result.ok) throw rejectionToProblem(result.error);
  return result.value;
}

/** User-requested transition of a strategy version. Terminal outcomes require a committee decision instead. */
export async function transitionVersion(ctx: AppContext, tx: Tx, scope: RequestScope, versionId: string, body: TransitionRequest, key: string): Promise<TransitionSuccess> {
  if (body.to === "PAPER_APPROVED" || body.to === "REJECTED") {
    throw problems.unprocessable("USE_DECISION_ENDPOINT", "approval and rejection are recorded through POST /v1/committee/decisions");
  }
  const [version] = await tx
    .select({ state: strategyVersions.state })
    .from(strategyVersions)
    .where(and(eq(strategyVersions.id, versionId), eq(strategyVersions.organisationId, scope.principal.organisationId)));
  if (!version) throw problems.notFound("strategy version");
  // Promotion past verification is judged on the server's evidence snapshot,
  // never on a client-chosen subset that could omit a failed parity report.
  const evidenceIds =
    body.to === "PAPER_APPROVAL_REVIEW"
      ? (await computeEvidence(tx, scope.principal.organisationId, versionId)).evidenceIds
      : body.evidenceIds;
  return applyTransition(ctx, tx, scope, {
    aggregate: "STRATEGY_VERSION",
    aggregateId: versionId,
    from: version.state,
    to: body.to,
    reasonCodes: body.reasonCodes,
    summary: body.summary,
    evidenceIds,
    key,
  });
}

export async function listTransitions(ctx: AppContext, scope: RequestScope, aggregateId: string) {
  const rows = await ctx.db
    .select()
    .from(stateTransitions)
    .where(and(eq(stateTransitions.organisationId, scope.principal.organisationId), eq(stateTransitions.aggregateId, aggregateId)))
    .orderBy(asc(stateTransitions.createdAt), asc(stateTransitions.id));
  return rows.map((r) => ({
    id: r.id,
    fromState: r.fromState,
    toState: r.toState,
    reasonCodes: r.reasonCodes,
    summary: r.summary,
    evidenceIds: r.evidenceIds,
    policyVersion: r.policyVersion,
    actorType: r.actorType,
    actorId: r.actorId,
    humanOverride: r.humanOverride,
    overrideReason: r.overrideReason,
    createdAt: iso(r.createdAt),
  }));
}

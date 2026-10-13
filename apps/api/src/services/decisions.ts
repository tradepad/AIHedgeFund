import { and, desc, eq } from "drizzle-orm";
import { EvidenceSnapshotSchema, uuidv7, type CreateDecisionRequest, type Decision, type EvidenceSnapshot } from "@arf/contracts";
import { committeeDecisions, type Tx } from "@arf/db";
import { WORKFLOW_POLICY_VERSION } from "@arf/workflow";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { audit, emit, iso } from "./common";
import { computeEvidence } from "./evidence";
import { loadVersion } from "./registry";
import { applyTransition } from "./transitions";

function toDecision(row: typeof committeeDecisions.$inferSelect): Decision {
  return {
    id: row.id,
    strategyVersionId: row.strategyVersionId,
    decision: row.decision,
    reasonCodes: row.reasonCodes,
    summary: row.summary,
    rejectionCase: row.rejectionCase,
    parityReportId: row.parityReportId,
    evidence: EvidenceSnapshotSchema.parse(row.evidence),
    policyVersion: row.policyVersion,
    humanOverride: row.humanOverride,
    overrideReason: row.overrideReason,
    decidedBy: row.decidedBy,
    createdAt: iso(row.createdAt),
  };
}

/** Conditions that an approval may only pass with an explicit, audited human override. */
export function overridableWarnings(evidence: EvidenceSnapshot): string[] {
  return evidence.warnings.filter((w) => w === "PARITY_WARN" || w === "LOW_TRADE_COUNT" || w === "PINE_LINT_WARNINGS" || w === "PARSER_WARNINGS");
}

/**
 * Record a committee decision and apply the resulting transition atomically.
 * PAPER_APPROVED is refused when required evidence is missing or parity is
 * FAIL; no override can bypass those. Warnings require a human override with
 * a reason, which is audited separately. The workflow engine independently
 * enforces role and separation of duties.
 */
export async function recordDecision(ctx: AppContext, tx: Tx, scope: RequestScope, body: CreateDecisionRequest, key: string): Promise<Decision> {
  const { version } = await loadVersion(tx, scope, body.strategyVersionId, true);
  const [existing] = await tx.select({ id: committeeDecisions.id }).from(committeeDecisions).where(eq(committeeDecisions.strategyVersionId, version.id));
  if (existing) throw problems.conflict("DECISION_EXISTS", "this version already has a committee decision; create a child version for further work");
  if (version.state === "PAPER_APPROVED" || version.state === "REJECTED") throw problems.conflict("TERMINAL_STATE", `version is ${version.state}`);

  const { evidenceIds, ...evidence } = await computeEvidence(tx, scope.principal.organisationId, version.id);
  if (body.parityReportId !== null && body.parityReportId !== evidence.parityReportId) {
    throw problems.conflict("STALE_EVIDENCE", "the parity report shown to the decision maker is not the current one; reload and review again");
  }

  const warnings = overridableWarnings(evidence);
  if (body.decision === "PAPER_APPROVED") {
    if (version.state !== "PAPER_APPROVAL_REVIEW") throw problems.conflict("INVALID_STATE", "approval requires the version to be in PAPER_APPROVAL_REVIEW");
    if (evidence.parityStatus === "FAIL" || evidence.hardFailures.length > 0) {
      throw problems.unprocessable("HARD_FAIL", `approval is blocked by hard failures: ${evidence.hardFailures.join(", ")}`);
    }
    if (evidence.missingEvidence.length > 0) {
      throw problems.unprocessable("EVIDENCE_MISSING", `approval requires: ${evidence.missingEvidence.join(", ")}`);
    }
    if (warnings.length > 0 && !body.humanOverride) {
      throw problems.unprocessable("OVERRIDE_REQUIRED", `approval with ${warnings.join(", ")} requires an explicit human override and reason`);
    }
  }
  const humanOverride = body.decision === "PAPER_APPROVED" && body.humanOverride;
  const overrideReason = humanOverride ? (body.overrideReason ?? null) : null;

  const id = uuidv7();
  const [row] = await tx
    .insert(committeeDecisions)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      strategyVersionId: version.id,
      decision: body.decision,
      reasonCodes: body.reasonCodes,
      summary: body.summary,
      rejectionCase: body.rejectionCase,
      parityReportId: evidence.parityReportId,
      evidence,
      policyVersion: WORKFLOW_POLICY_VERSION,
      humanOverride,
      overrideReason,
      decidedBy: scope.principal.userId,
    })
    .returning();
  if (!row) throw new Error("decision insert returned no row");

  await audit(tx, scope, {
    action: "DECISION_RECORDED",
    aggregateType: "STRATEGY_VERSION",
    aggregateId: version.id,
    priorState: { state: version.state },
    newState: { decisionId: id, decision: body.decision, parityStatus: evidence.parityStatus, warnings: evidence.warnings, humanOverride },
    reason: body.summary,
  });
  if (humanOverride) {
    await audit(tx, scope, {
      action: "HUMAN_OVERRIDE",
      aggregateType: "STRATEGY_VERSION",
      aggregateId: version.id,
      newState: { decisionId: id, overriddenWarnings: warnings },
      reason: overrideReason ?? "",
    });
  }

  await applyTransition(ctx, tx, scope, {
    aggregate: "STRATEGY_VERSION",
    aggregateId: version.id,
    from: version.state,
    to: body.decision === "PAPER_APPROVED" ? "PAPER_APPROVED" : "REJECTED",
    reasonCodes: body.reasonCodes,
    summary: body.summary,
    evidenceIds: body.decision === "PAPER_APPROVED" ? [id, ...evidenceIds] : [id],
    key,
    humanOverride,
    overrideReason,
  });
  await emit(tx, scope, { eventType: "committee_decision.created", aggregateType: "DECISION", aggregateId: id, payload: { decisionId: id, strategyVersionId: version.id, decision: body.decision } });
  return toDecision(row);
}

export async function getDecisionContext(ctx: AppContext, scope: RequestScope, versionId: string): Promise<{ evidence: EvidenceSnapshot; overridableWarnings: string[]; decision: Decision | null }> {
  await loadVersion(ctx.db, scope, versionId);
  const { evidenceIds: _ids, ...evidence } = await computeEvidence(ctx.db, scope.principal.organisationId, versionId);
  const [row] = await ctx.db
    .select()
    .from(committeeDecisions)
    .where(and(eq(committeeDecisions.organisationId, scope.principal.organisationId), eq(committeeDecisions.strategyVersionId, versionId)))
    .orderBy(desc(committeeDecisions.createdAt))
    .limit(1);
  return { evidence, overridableWarnings: overridableWarnings(evidence), decision: row ? toDecision(row) : null };
}

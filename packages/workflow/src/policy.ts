import { err, ok, type ActorType, type MemberRole, type ParityStatus, type Result, type WorkflowState } from "@arf/contracts";

/** Version of the transition policy. Recorded on every transition and decision. */
export const WORKFLOW_POLICY_VERSION = "workflow-policy/1.0.0";

export type WorkflowAggregate = "STRATEGY_VERSION" | "RESEARCH_TASK";

export const TERMINAL_STATES: readonly WorkflowState[] = ["PAPER_APPROVED", "REJECTED"];

export type EvidenceRequirement =
  | "STRATEGY_DEFINITION"
  | "PINE_REVISION_LINT_OK"
  | "PINE_MANIFEST_MATCHES_VERSION"
  | "PARITY_NOT_FAILED"
  | "PARITY_PASS_OR_WARN"
  | "METRICS_CALCULATED"
  | "COMMITTEE_DECISION"
  | "IDEA_CARD"
  | "RETURN_TO_PRE_BLOCK_STATE";

export interface TransitionRule {
  id: string;
  aggregate: WorkflowAggregate;
  from: readonly WorkflowState[];
  to: WorkflowState;
  allowedActorTypes: readonly ActorType[];
  allowedRoles: readonly MemberRole[];
  evidence: readonly EvidenceRequirement[];
  /** A human must perform this transition. */
  requiresHuman: boolean;
  /** Actor must not have authored the version's SDL, Pine or the version itself. */
  requiresIndependentActor: boolean;
}

const NON_TERMINAL_VERSION_STATES: readonly WorkflowState[] = [
  "HYPOTHESIS_DRAFT",
  "PINE_DEVELOPMENT",
  "TRADINGVIEW_VERIFICATION",
  "PAPER_APPROVAL_REVIEW",
  "BLOCKED",
];

/**
 * The complete transition table for this release. Anything not listed is
 * rejected. Models (AGENT actors) cannot transition strategy versions.
 */
export const TRANSITION_RULES: readonly TransitionRule[] = [
  // --- Research tasks -----------------------------------------------------
  {
    id: "task.start_research",
    aggregate: "RESEARCH_TASK",
    from: ["CAMPAIGN_BACKLOG"],
    to: "IDEA_RESEARCH",
    allowedActorTypes: ["USER", "SERVICE"],
    allowedRoles: ["RESEARCHER", "ADMIN", "SERVICE_ACCOUNT"],
    evidence: [],
    requiresHuman: false,
    requiresIndependentActor: false,
  },
  {
    id: "task.hypothesis_drafted",
    aggregate: "RESEARCH_TASK",
    from: ["IDEA_RESEARCH"],
    to: "HYPOTHESIS_DRAFT",
    allowedActorTypes: ["USER", "SERVICE"],
    allowedRoles: ["RESEARCHER", "ADMIN", "SERVICE_ACCOUNT"],
    evidence: ["IDEA_CARD"],
    requiresHuman: false,
    requiresIndependentActor: false,
  },
  {
    id: "task.reject",
    aggregate: "RESEARCH_TASK",
    from: ["CAMPAIGN_BACKLOG", "IDEA_RESEARCH", "HYPOTHESIS_DRAFT", "BLOCKED"],
    to: "REJECTED",
    allowedActorTypes: ["USER", "SERVICE"],
    allowedRoles: ["RESEARCHER", "ADMIN", "SERVICE_ACCOUNT"],
    evidence: [],
    requiresHuman: false,
    requiresIndependentActor: false,
  },
  {
    id: "task.block",
    aggregate: "RESEARCH_TASK",
    from: ["CAMPAIGN_BACKLOG", "IDEA_RESEARCH"],
    to: "BLOCKED",
    allowedActorTypes: ["USER", "SERVICE"],
    allowedRoles: ["RESEARCHER", "ADMIN", "SERVICE_ACCOUNT"],
    evidence: [],
    requiresHuman: false,
    requiresIndependentActor: false,
  },
  // --- Strategy versions --------------------------------------------------
  {
    id: "version.start_pine_development",
    aggregate: "STRATEGY_VERSION",
    from: ["HYPOTHESIS_DRAFT"],
    to: "PINE_DEVELOPMENT",
    allowedActorTypes: ["USER"],
    allowedRoles: ["RESEARCHER", "DEVELOPER", "ADMIN"],
    evidence: ["STRATEGY_DEFINITION"],
    requiresHuman: true,
    requiresIndependentActor: false,
  },
  {
    id: "version.request_tradingview_verification",
    aggregate: "STRATEGY_VERSION",
    from: ["PINE_DEVELOPMENT"],
    to: "TRADINGVIEW_VERIFICATION",
    allowedActorTypes: ["USER"],
    allowedRoles: ["RESEARCHER", "DEVELOPER", "ADMIN"],
    evidence: ["STRATEGY_DEFINITION", "PINE_REVISION_LINT_OK", "PINE_MANIFEST_MATCHES_VERSION"],
    requiresHuman: true,
    requiresIndependentActor: false,
  },
  {
    id: "version.submit_for_paper_review",
    aggregate: "STRATEGY_VERSION",
    from: ["TRADINGVIEW_VERIFICATION"],
    to: "PAPER_APPROVAL_REVIEW",
    allowedActorTypes: ["USER", "SERVICE"],
    allowedRoles: ["RESEARCHER", "VALIDATOR", "ADMIN", "SERVICE_ACCOUNT"],
    evidence: ["PARITY_NOT_FAILED", "METRICS_CALCULATED"],
    requiresHuman: false,
    requiresIndependentActor: false,
  },
  {
    id: "version.paper_approve",
    aggregate: "STRATEGY_VERSION",
    from: ["PAPER_APPROVAL_REVIEW"],
    to: "PAPER_APPROVED",
    allowedActorTypes: ["USER"],
    allowedRoles: ["COMMITTEE_MEMBER", "ADMIN"],
    evidence: ["COMMITTEE_DECISION", "PARITY_PASS_OR_WARN", "METRICS_CALCULATED"],
    requiresHuman: true,
    requiresIndependentActor: true,
  },
  {
    id: "version.reject",
    aggregate: "STRATEGY_VERSION",
    from: NON_TERMINAL_VERSION_STATES,
    to: "REJECTED",
    allowedActorTypes: ["USER"],
    allowedRoles: ["COMMITTEE_MEMBER", "ADMIN"],
    evidence: ["COMMITTEE_DECISION"],
    requiresHuman: true,
    requiresIndependentActor: false,
  },
  {
    id: "version.block",
    aggregate: "STRATEGY_VERSION",
    from: ["HYPOTHESIS_DRAFT", "PINE_DEVELOPMENT", "TRADINGVIEW_VERIFICATION", "PAPER_APPROVAL_REVIEW"],
    to: "BLOCKED",
    allowedActorTypes: ["USER", "SERVICE"],
    allowedRoles: ["RESEARCHER", "DEVELOPER", "VALIDATOR", "OPERATOR", "ADMIN", "SERVICE_ACCOUNT"],
    evidence: [],
    requiresHuman: false,
    requiresIndependentActor: false,
  },
  {
    id: "version.unblock",
    aggregate: "STRATEGY_VERSION",
    from: ["BLOCKED"],
    to: "HYPOTHESIS_DRAFT",
    allowedActorTypes: ["USER"],
    allowedRoles: ["ADMIN"],
    evidence: ["RETURN_TO_PRE_BLOCK_STATE"],
    requiresHuman: true,
    requiresIndependentActor: false,
  },
  ...(["PINE_DEVELOPMENT", "TRADINGVIEW_VERIFICATION", "PAPER_APPROVAL_REVIEW"] as const).map(
    (to): TransitionRule => ({
      id: `version.unblock_to_${to.toLowerCase()}`,
      aggregate: "STRATEGY_VERSION",
      from: ["BLOCKED"],
      to,
      allowedActorTypes: ["USER"],
      allowedRoles: ["ADMIN"],
      evidence: ["RETURN_TO_PRE_BLOCK_STATE"],
      requiresHuman: true,
      requiresIndependentActor: false,
    }),
  ),
];

/** Facts gathered from the database by the engine; the policy is pure over these. */
export interface EvidenceFacts {
  hasStrategyDefinition: boolean;
  pineLintStatus: "PASS" | "WARN" | "FAIL" | null;
  pineManifestMatchesVersion: boolean | null;
  parityStatus: ParityStatus | null;
  metricsCalculated: boolean;
  committeeDecision: "REJECT" | "REWORK_WITH_NEW_VERSION" | "PAPER_APPROVED" | null;
  ideaCardPresent: boolean;
  preBlockState: WorkflowState | null;
  authorUserIds: string[];
  unresolvedEvidenceIds: string[];
}

export interface TransitionActor {
  type: ActorType;
  id: string;
  roles: readonly MemberRole[];
}

export type TransitionRejectionCode =
  | "TRANSITION_NOT_ALLOWED"
  | "TERMINAL_STATE"
  | "ACTOR_TYPE_NOT_ALLOWED"
  | "ROLE_NOT_ALLOWED"
  | "SEPARATION_OF_DUTIES"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_NOT_FOUND"
  | "HARD_FAIL"
  | "STALE_STATE"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT";

export interface TransitionRejection {
  code: TransitionRejectionCode;
  detail: string;
  missing?: EvidenceRequirement[];
}

export function findRule(aggregate: WorkflowAggregate, from: WorkflowState, to: WorkflowState): TransitionRule | undefined {
  return TRANSITION_RULES.find((r) => r.aggregate === aggregate && r.to === to && r.from.includes(from));
}

export function allowedTargets(aggregate: WorkflowAggregate, from: WorkflowState): WorkflowState[] {
  return TRANSITION_RULES.filter((r) => r.aggregate === aggregate && r.from.includes(from)).map((r) => r.to);
}

function evidenceSatisfied(req: EvidenceRequirement, facts: EvidenceFacts, to: WorkflowState): boolean {
  switch (req) {
    case "STRATEGY_DEFINITION":
      return facts.hasStrategyDefinition;
    case "PINE_REVISION_LINT_OK":
      return facts.pineLintStatus === "PASS" || facts.pineLintStatus === "WARN";
    case "PINE_MANIFEST_MATCHES_VERSION":
      return facts.pineManifestMatchesVersion === true;
    case "PARITY_NOT_FAILED":
      return facts.parityStatus !== null && facts.parityStatus !== "FAIL";
    case "PARITY_PASS_OR_WARN":
      return facts.parityStatus === "PASS" || facts.parityStatus === "WARN";
    case "METRICS_CALCULATED":
      return facts.metricsCalculated;
    case "COMMITTEE_DECISION":
      if (to === "PAPER_APPROVED") return facts.committeeDecision === "PAPER_APPROVED";
      if (to === "REJECTED") return facts.committeeDecision === "REJECT" || facts.committeeDecision === "REWORK_WITH_NEW_VERSION";
      return facts.committeeDecision !== null;
    case "IDEA_CARD":
      return facts.ideaCardPresent;
    case "RETURN_TO_PRE_BLOCK_STATE":
      return facts.preBlockState === to;
  }
}

/**
 * Pure policy evaluation. Expected rejections are returned, never thrown.
 * Hard failures (parity FAIL, lint FAIL) block forward progress regardless of
 * any other evidence.
 */
export function evaluateTransition(input: {
  aggregate: WorkflowAggregate;
  from: WorkflowState;
  to: WorkflowState;
  actor: TransitionActor;
  facts: EvidenceFacts;
}): Result<TransitionRule, TransitionRejection> {
  const { aggregate, from, to, actor, facts } = input;
  if (TERMINAL_STATES.includes(from)) {
    return err({ code: "TERMINAL_STATE", detail: `${from} is terminal; create a child version instead` });
  }
  const rule = findRule(aggregate, from, to);
  if (!rule) return err({ code: "TRANSITION_NOT_ALLOWED", detail: `${aggregate} cannot move from ${from} to ${to}` });
  if (!rule.allowedActorTypes.includes(actor.type) || (rule.requiresHuman && actor.type !== "USER")) {
    return err({ code: "ACTOR_TYPE_NOT_ALLOWED", detail: `${actor.type} actors cannot perform ${rule.id}` });
  }
  if (!actor.roles.some((r) => rule.allowedRoles.includes(r))) {
    return err({ code: "ROLE_NOT_ALLOWED", detail: `${rule.id} requires one of ${rule.allowedRoles.join(", ")}` });
  }
  if (rule.requiresIndependentActor && facts.authorUserIds.includes(actor.id)) {
    return err({ code: "SEPARATION_OF_DUTIES", detail: "the author of a version cannot approve it" });
  }
  if (facts.unresolvedEvidenceIds.length > 0) {
    return err({ code: "EVIDENCE_NOT_FOUND", detail: `evidence ids do not resolve: ${facts.unresolvedEvidenceIds.join(", ")}` });
  }
  const forward = to !== "REJECTED" && to !== "BLOCKED";
  if (forward && facts.parityStatus === "FAIL" && (from === "TRADINGVIEW_VERIFICATION" || from === "PAPER_APPROVAL_REVIEW")) {
    return err({ code: "HARD_FAIL", detail: "parity FAIL blocks promotion; reject or rework the version" });
  }
  if (forward && facts.pineLintStatus === "FAIL" && to !== "PINE_DEVELOPMENT") {
    return err({ code: "HARD_FAIL", detail: "Pine lint hard errors block promotion" });
  }
  const missing = rule.evidence.filter((req) => !evidenceSatisfied(req, facts, to));
  if (missing.length > 0) {
    return err({ code: "EVIDENCE_MISSING", detail: `missing evidence: ${missing.join(", ")}`, missing });
  }
  return ok(rule);
}

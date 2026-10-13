import { describe, expect, it } from "vitest";
import type { WorkflowState } from "@arf/contracts";
import { TRANSITION_RULES, allowedTargets, evaluateTransition, type EvidenceFacts, type TransitionActor } from "../src";

const facts = (overrides: Partial<EvidenceFacts> = {}): EvidenceFacts => ({
  hasStrategyDefinition: false,
  pineLintStatus: null,
  pineManifestMatchesVersion: null,
  parityStatus: null,
  metricsCalculated: false,
  committeeDecision: null,
  ideaCardPresent: false,
  preBlockState: null,
  authorUserIds: ["author"],
  unresolvedEvidenceIds: [],
  ...overrides,
});
const researcher: TransitionActor = { type: "USER", id: "author", roles: ["RESEARCHER", "DEVELOPER"] };
const committee: TransitionActor = { type: "USER", id: "judge", roles: ["COMMITTEE_MEMBER"] };
const agent: TransitionActor = { type: "AGENT", id: "idea-scout", roles: ["ADMIN"] };

const run = (from: WorkflowState, to: WorkflowState, actor: TransitionActor, f: EvidenceFacts) =>
  evaluateTransition({ aggregate: "STRATEGY_VERSION", from, to, actor, facts: f });

describe("strategy version policy", () => {
  it("requires an SDL before Pine development", () => {
    const r = run("HYPOTHESIS_DRAFT", "PINE_DEVELOPMENT", researcher, facts());
    expect(r).toMatchObject({ ok: false, error: { code: "EVIDENCE_MISSING", missing: ["STRATEGY_DEFINITION"] } });
    expect(run("HYPOTHESIS_DRAFT", "PINE_DEVELOPMENT", researcher, facts({ hasStrategyDefinition: true })).ok).toBe(true);
  });

  it("requires lint-clean Pine with a matching manifest before TradingView verification", () => {
    const base = { hasStrategyDefinition: true, pineManifestMatchesVersion: true };
    expect(run("PINE_DEVELOPMENT", "TRADINGVIEW_VERIFICATION", researcher, facts({ ...base, pineLintStatus: "FAIL" })).ok).toBe(false);
    expect(
      run("PINE_DEVELOPMENT", "TRADINGVIEW_VERIFICATION", researcher, facts({ ...base, pineLintStatus: "WARN", pineManifestMatchesVersion: false }))
        .ok,
    ).toBe(false);
    expect(run("PINE_DEVELOPMENT", "TRADINGVIEW_VERIFICATION", researcher, facts({ ...base, pineLintStatus: "WARN" })).ok).toBe(true);
  });

  it("treats parity FAIL as a hard failure for promotion", () => {
    const r = run("TRADINGVIEW_VERIFICATION", "PAPER_APPROVAL_REVIEW", researcher, facts({ parityStatus: "FAIL", metricsCalculated: true }));
    expect(r).toMatchObject({ ok: false, error: { code: "HARD_FAIL" } });
  });

  it("does not allow paper approval with INSUFFICIENT_DATA parity", () => {
    const r = run(
      "PAPER_APPROVAL_REVIEW",
      "PAPER_APPROVED",
      committee,
      facts({ parityStatus: "INSUFFICIENT_DATA", metricsCalculated: true, committeeDecision: "PAPER_APPROVED" }),
    );
    expect(r).toMatchObject({ ok: false, error: { code: "EVIDENCE_MISSING" } });
  });

  it("enforces separation of duties for paper approval", () => {
    const f = facts({ parityStatus: "PASS", metricsCalculated: true, committeeDecision: "PAPER_APPROVED" });
    const selfApprove = run("PAPER_APPROVAL_REVIEW", "PAPER_APPROVED", { ...researcher, roles: ["COMMITTEE_MEMBER"] }, f);
    expect(selfApprove).toMatchObject({ ok: false, error: { code: "SEPARATION_OF_DUTIES" } });
    expect(run("PAPER_APPROVAL_REVIEW", "PAPER_APPROVED", committee, f).ok).toBe(true);
  });

  it("only lets committee members approve", () => {
    const f = facts({ parityStatus: "PASS", metricsCalculated: true, committeeDecision: "PAPER_APPROVED", authorUserIds: [] });
    expect(run("PAPER_APPROVAL_REVIEW", "PAPER_APPROVED", researcher, f)).toMatchObject({ ok: false, error: { code: "ROLE_NOT_ALLOWED" } });
  });

  it("never lets an agent transition a strategy version", () => {
    expect(run("HYPOTHESIS_DRAFT", "PINE_DEVELOPMENT", agent, facts({ hasStrategyDefinition: true }))).toMatchObject({
      ok: false,
      error: { code: "ACTOR_TYPE_NOT_ALLOWED" },
    });
  });

  it("treats terminal states as final", () => {
    expect(run("REJECTED", "PINE_DEVELOPMENT", researcher, facts())).toMatchObject({ ok: false, error: { code: "TERMINAL_STATE" } });
    expect(run("PAPER_APPROVED", "REJECTED", committee, facts())).toMatchObject({ ok: false, error: { code: "TERMINAL_STATE" } });
  });

  it("rejects transitions that skip stages", () => {
    expect(run("HYPOTHESIS_DRAFT", "PAPER_APPROVED", committee, facts())).toMatchObject({
      ok: false,
      error: { code: "TRANSITION_NOT_ALLOWED" },
    });
  });

  it("rejects unresolved evidence ids", () => {
    const r = run("HYPOTHESIS_DRAFT", "PINE_DEVELOPMENT", researcher, facts({ hasStrategyDefinition: true, unresolvedEvidenceIds: ["x"] }));
    expect(r).toMatchObject({ ok: false, error: { code: "EVIDENCE_NOT_FOUND" } });
  });

  it("requires a matching decision record to reject", () => {
    expect(run("PAPER_APPROVAL_REVIEW", "REJECTED", committee, facts({ committeeDecision: "PAPER_APPROVED" })).ok).toBe(false);
    expect(run("PAPER_APPROVAL_REVIEW", "REJECTED", committee, facts({ committeeDecision: "REWORK_WITH_NEW_VERSION" })).ok).toBe(true);
  });

  it("only unblocks back to the state the version was blocked from", () => {
    const admin: TransitionActor = { type: "USER", id: "admin", roles: ["ADMIN"] };
    expect(run("BLOCKED", "PINE_DEVELOPMENT", admin, facts({ preBlockState: "TRADINGVIEW_VERIFICATION" })).ok).toBe(false);
    expect(run("BLOCKED", "TRADINGVIEW_VERIFICATION", admin, facts({ preBlockState: "TRADINGVIEW_VERIFICATION" })).ok).toBe(true);
  });

  it("has no rule leaving a terminal state and no rule granting live states", () => {
    for (const rule of TRANSITION_RULES) {
      expect(rule.from).not.toContain("PAPER_APPROVED");
      expect(rule.from).not.toContain("REJECTED");
    }
    expect(allowedTargets("STRATEGY_VERSION", "PAPER_APPROVAL_REVIEW").sort()).toEqual(["BLOCKED", "PAPER_APPROVED", "REJECTED"]);
  });
});

describe("research task policy", () => {
  it("requires an idea card to reach hypothesis draft", () => {
    const service: TransitionActor = { type: "SERVICE", id: "orchestrator", roles: ["SERVICE_ACCOUNT"] };
    const ev = (f: EvidenceFacts) =>
      evaluateTransition({ aggregate: "RESEARCH_TASK", from: "IDEA_RESEARCH", to: "HYPOTHESIS_DRAFT", actor: service, facts: f });
    expect(ev(facts()).ok).toBe(false);
    expect(ev(facts({ ideaCardPresent: true })).ok).toBe(true);
  });
});

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  err,
  ok,
  uuidv7,
  PineManifestSchema,
  type Result,
  type WorkflowState,
} from "@arf/contracts";
import {
  appendAudit,
  backtestRuns,
  committeeDecisions,
  enqueueOutbox,
  ideaCards,
  metricSnapshots,
  parityReports,
  pineRevisions,
  researchTasks,
  stateTransitions,
  strategyDefinitions,
  strategyVersions,
  tradingviewVerifications,
  type DbOrTx,
} from "@arf/db";
import {
  WORKFLOW_POLICY_VERSION,
  evaluateTransition,
  type EvidenceFacts,
  type TransitionActor,
  type TransitionRejection,
  type WorkflowAggregate,
} from "./policy";

export interface TransitionCommand {
  organisationId: string;
  aggregate: WorkflowAggregate;
  aggregateId: string;
  from: WorkflowState;
  to: WorkflowState;
  actor: TransitionActor;
  reasonCodes: string[];
  summary: string;
  evidenceIds: string[];
  /** Deterministic key; a retry with the same key returns the original result. */
  transitionKey: string;
  traceId: string;
  correlationId: string;
  humanOverride?: boolean;
  overrideReason?: string | null;
}

export interface TransitionSuccess {
  transitionId: string;
  from: WorkflowState;
  to: WorkflowState;
  ruleId: string;
  policyVersion: string;
  replayed: boolean;
}

interface AggregateRow {
  state: WorkflowState;
  authorUserIds: string[];
  definitionHash: string | null;
  symbol: string | null;
  timeframe: string | null;
  strategyId: string | null;
}

/**
 * The only code path that changes lifecycle state. Runs inside the caller's
 * transaction so that a decision (or any other command) and its transition
 * commit or roll back together. Expected policy rejections are returned as
 * typed failures; the caller decides whether to roll back.
 */
export class WorkflowEngine {
  readonly policyVersion = WORKFLOW_POLICY_VERSION;

  async transition(
    tx: DbOrTx,
    command: TransitionCommand,
  ): Promise<Result<TransitionSuccess, TransitionRejection>> {
    const aggregate = await this.lockAggregate(tx, command);
    if (!aggregate) return err({ code: "NOT_FOUND", detail: `${command.aggregate} not found` });

    const [existing] = await tx
      .select()
      .from(stateTransitions)
      .where(eq(stateTransitions.transitionKey, command.transitionKey))
      .limit(1);
    if (existing) {
      if (
        existing.aggregateId === command.aggregateId &&
        existing.fromState === command.from &&
        existing.toState === command.to
      ) {
        return ok({
          transitionId: existing.id,
          from: existing.fromState,
          to: existing.toState,
          ruleId: "replay",
          policyVersion: existing.policyVersion,
          replayed: true,
        });
      }
      return err({
        code: "IDEMPOTENCY_CONFLICT",
        detail: "transition key was used for a different transition",
      });
    }

    if (aggregate.state !== command.from) {
      return err({
        code: "STALE_STATE",
        detail: `expected ${command.from} but current state is ${aggregate.state}`,
      });
    }

    const facts = await this.loadFacts(tx, command, aggregate);
    const evaluation = evaluateTransition({
      aggregate: command.aggregate,
      from: command.from,
      to: command.to,
      actor: command.actor,
      facts,
    });
    if (!evaluation.ok) return evaluation;

    const transitionId = uuidv7();
    await tx.insert(stateTransitions).values({
      id: transitionId,
      organisationId: command.organisationId,
      aggregateType: command.aggregate,
      aggregateId: command.aggregateId,
      fromState: command.from,
      toState: command.to,
      reasonCodes: command.reasonCodes,
      summary: command.summary,
      evidenceIds: command.evidenceIds,
      policyVersion: WORKFLOW_POLICY_VERSION,
      actorType: command.actor.type,
      actorId: command.actor.id,
      humanOverride: command.humanOverride ?? false,
      overrideReason: command.overrideReason ?? null,
      transitionKey: command.transitionKey,
    });

    const now = new Date();
    if (command.aggregate === "STRATEGY_VERSION") {
      await tx
        .update(strategyVersions)
        .set({
          state: command.to,
          updatedAt: now,
          ...(command.to === "TRADINGVIEW_VERIFICATION" ? { lockedAt: now } : {}),
        })
        .where(eq(strategyVersions.id, command.aggregateId));
    } else {
      await tx
        .update(researchTasks)
        .set({ state: command.to, updatedAt: now })
        .where(eq(researchTasks.id, command.aggregateId));
    }

    await appendAudit(tx, {
      organisationId: command.organisationId,
      actorType: command.actor.type,
      actorId: command.actor.id,
      action: "STATE_TRANSITIONED",
      aggregateType: command.aggregate,
      aggregateId: command.aggregateId,
      priorState: { state: command.from },
      newState: {
        state: command.to,
        ruleId: evaluation.value.id,
        reasonCodes: command.reasonCodes,
        evidenceIds: command.evidenceIds,
        humanOverride: command.humanOverride ?? false,
      },
      reason: command.summary,
      traceId: command.traceId,
    });

    await enqueueOutbox(tx, {
      organisationId: command.organisationId,
      eventType: "strategy_version.transitioned",
      aggregateType: command.aggregate,
      aggregateId: command.aggregateId,
      correlationId: command.correlationId,
      causationId: transitionId,
      actor: { type: command.actor.type, id: command.actor.id },
      traceId: command.traceId,
      payload: {
        from: command.from,
        to: command.to,
        transitionId,
        policyVersion: WORKFLOW_POLICY_VERSION,
      },
    });

    return ok({
      transitionId,
      from: command.from,
      to: command.to,
      ruleId: evaluation.value.id,
      policyVersion: WORKFLOW_POLICY_VERSION,
      replayed: false,
    });
  }

  private async lockAggregate(
    tx: DbOrTx,
    command: TransitionCommand,
  ): Promise<AggregateRow | null> {
    if (command.aggregate === "STRATEGY_VERSION") {
      const [row] = await tx
        .select()
        .from(strategyVersions)
        .where(
          and(
            eq(strategyVersions.id, command.aggregateId),
            eq(strategyVersions.organisationId, command.organisationId),
          ),
        )
        .for("update");
      if (!row) return null;
      return {
        state: row.state,
        authorUserIds: [row.createdBy],
        definitionHash: row.definitionHash,
        symbol: row.symbol,
        timeframe: row.timeframe,
        strategyId: row.strategyId,
      };
    }
    const [row] = await tx
      .select()
      .from(researchTasks)
      .where(
        and(
          eq(researchTasks.id, command.aggregateId),
          eq(researchTasks.organisationId, command.organisationId),
        ),
      )
      .for("update");
    if (!row) return null;
    return {
      state: row.state,
      authorUserIds: [],
      definitionHash: null,
      symbol: null,
      timeframe: null,
      strategyId: null,
    };
  }

  private async loadFacts(
    tx: DbOrTx,
    command: TransitionCommand,
    aggregate: AggregateRow,
  ): Promise<EvidenceFacts> {
    const facts: EvidenceFacts = {
      hasStrategyDefinition: false,
      pineLintStatus: null,
      pineManifestMatchesVersion: null,
      parityStatus: null,
      metricsCalculated: false,
      committeeDecision: null,
      ideaCardPresent: false,
      preBlockState: null,
      authorUserIds: [...aggregate.authorUserIds],
      unresolvedEvidenceIds: [],
    };
    const org = command.organisationId;
    const ids = [...new Set(command.evidenceIds)];
    const resolved = new Set<string>();

    if (command.aggregate === "STRATEGY_VERSION") {
      const versionId = command.aggregateId;
      // Authors are always loaded, independent of the evidence offered.
      const [sdl] = await tx
        .select()
        .from(strategyDefinitions)
        .where(eq(strategyDefinitions.strategyVersionId, versionId));
      const [pine] = await tx
        .select()
        .from(pineRevisions)
        .where(eq(pineRevisions.strategyVersionId, versionId));
      if (sdl) facts.authorUserIds.push(sdl.createdBy);
      if (pine) facts.authorUserIds.push(pine.createdBy);

      if (ids.length > 0) {
        if (sdl && ids.includes(sdl.id) && sdl.organisationId === org) {
          resolved.add(sdl.id);
          facts.hasStrategyDefinition = true;
        }
        if (pine && ids.includes(pine.id) && pine.organisationId === org) {
          resolved.add(pine.id);
          facts.pineLintStatus = pine.lintStatus;
          const manifest = PineManifestSchema.safeParse(pine.manifest);
          facts.pineManifestMatchesVersion =
            manifest.success &&
            manifest.data.strategyVersionId === versionId &&
            manifest.data.strategyId === aggregate.strategyId &&
            manifest.data.symbol === aggregate.symbol &&
            manifest.data.timeframe === aggregate.timeframe &&
            manifest.data.sdlHash === aggregate.definitionHash;
        }
        const parity = await tx
          .select({
            id: parityReports.id,
            status: parityReports.status,
            runId: parityReports.backtestRunId,
          })
          .from(parityReports)
          .innerJoin(
            tradingviewVerifications,
            eq(tradingviewVerifications.id, parityReports.verificationId),
          )
          .where(
            and(
              inArray(parityReports.id, ids),
              eq(parityReports.organisationId, org),
              eq(tradingviewVerifications.strategyVersionId, versionId),
            ),
          );
        for (const p of parity) {
          resolved.add(p.id);
          facts.parityStatus = p.status;
        }
        const runs = await tx
          .select({ id: backtestRuns.id })
          .from(backtestRuns)
          .where(
            and(
              inArray(backtestRuns.id, ids),
              eq(backtestRuns.organisationId, org),
              eq(backtestRuns.strategyVersionId, versionId),
            ),
          );
        for (const run of runs) {
          resolved.add(run.id);
          const [metric] = await tx
            .select({ id: metricSnapshots.id })
            .from(metricSnapshots)
            .where(
              and(
                eq(metricSnapshots.scopeType, "RUN"),
                eq(metricSnapshots.scopeId, run.id),
                eq(metricSnapshots.source, "ARF_CALCULATED"),
                eq(metricSnapshots.metricName, "closed_trade_count"),
              ),
            )
            .limit(1);
          if (metric) facts.metricsCalculated = true;
        }
        const decisions = await tx
          .select()
          .from(committeeDecisions)
          .where(
            and(
              inArray(committeeDecisions.id, ids),
              eq(committeeDecisions.organisationId, org),
              eq(committeeDecisions.strategyVersionId, versionId),
            ),
          );
        for (const d of decisions) {
          resolved.add(d.id);
          facts.committeeDecision = d.decision;
        }
      }
    } else if (ids.length > 0) {
      const cards = await tx
        .select({ id: ideaCards.id })
        .from(ideaCards)
        .where(
          and(
            inArray(ideaCards.id, ids),
            eq(ideaCards.organisationId, org),
            eq(ideaCards.taskId, command.aggregateId),
          ),
        );
      for (const c of cards) {
        resolved.add(c.id);
        facts.ideaCardPresent = true;
      }
    }

    if (command.from === "BLOCKED") {
      const [blocked] = await tx
        .select({ fromState: stateTransitions.fromState })
        .from(stateTransitions)
        .where(
          and(
            eq(stateTransitions.aggregateId, command.aggregateId),
            eq(stateTransitions.toState, "BLOCKED"),
          ),
        )
        .orderBy(desc(stateTransitions.createdAt), desc(stateTransitions.id))
        .limit(1);
      facts.preBlockState = blocked?.fromState ?? null;
    }

    facts.unresolvedEvidenceIds = ids.filter((id) => !resolved.has(id));
    return facts;
  }
}

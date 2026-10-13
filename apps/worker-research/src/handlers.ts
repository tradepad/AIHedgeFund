import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { EventPayloads, HandoffSchema, IdeaCardSchema, canonicalJson, uuidv7, type AgentTask, type IdeaCard } from "@arf/contracts";
import { deterministicUuid, sha256Hex } from "@arf/contracts/node";
import { runStructured, type ModelProvider, type RunOutcome } from "@arf/agent-runtime";
import { agentRuns, appendAudit, artefacts, enqueueOutbox, handoffs, ideaCards, promptVersions, researchTasks, type Database, type DbOrTx } from "@arf/db";
import { TerminalJobError, type JobPayload } from "@arf/event-bus";
import { instruments } from "@arf/observability";
import { objectPaths, type ObjectStore } from "@arf/storage";

export const SERVICE_ACTOR = { type: "SERVICE" as const, id: "service:worker-research" };

export interface ResearchDeps {
  db: Database;
  store: ObjectStore;
  provider: ModelProvider;
}

const TaskInputSchema = z.object({ objective: z.string().min(1).max(4000) }).loose();

async function storeObject(
  db: DbOrTx,
  store: ObjectStore,
  input: { organisationId: string; kind: "IDEA_CARD" | "AGENT_RAW_OUTPUT"; key: string; bytes: Uint8Array; protection: "STANDARD" | "PROTECTED" },
): Promise<string> {
  const sha = sha256Hex(input.bytes);
  const [existing] = await db
    .select({ id: artefacts.id })
    .from(artefacts)
    .where(and(eq(artefacts.organisationId, input.organisationId), eq(artefacts.kind, input.kind), eq(artefacts.sha256, sha)));
  if (existing) return existing.id;
  await store.putImmutable(input.key, input.bytes, "application/json");
  const id = uuidv7();
  await db.insert(artefacts).values({
    id,
    organisationId: input.organisationId,
    kind: input.kind,
    objectKey: input.key,
    sha256: sha,
    sizeBytes: input.bytes.byteLength,
    contentType: "application/json",
    protection: input.protection,
    createdBy: SERVICE_ACTOR.id,
  });
  return id;
}

/**
 * agent.run (IDEA_SCOUT): call the provider through the structured runner,
 * keep raw provider output in a PROTECTED artefact, and record only validated
 * structured output. The worker never changes task state: it emits
 * agent_run.completed and the orchestrator applies the transition.
 */
export async function handleAgentRun(deps: ResearchDeps, job: JobPayload): Promise<void> {
  const data = EventPayloads["agent_run.requested"].parse(job.payload);
  const org = job.organisationId;
  const [run] = await deps.db.select().from(agentRuns).where(and(eq(agentRuns.id, data.agentRunId), eq(agentRuns.organisationId, org)));
  if (!run) throw new TerminalJobError("AGENT_RUN_NOT_FOUND", "agent run does not exist in this organisation");
  if (run.status !== "RUNNING") return;
  const [task] = await deps.db.select().from(researchTasks).where(and(eq(researchTasks.id, data.taskId), eq(researchTasks.organisationId, org)));
  if (!task) throw new TerminalJobError("TASK_NOT_FOUND", "research task does not exist in this organisation");
  const [prompt] = await deps.db.select().from(promptVersions).where(eq(promptVersions.id, run.promptVersionId));
  if (prompt?.status !== "APPROVED") throw new TerminalJobError("PROMPT_NOT_APPROVED", "the run's prompt version is not approved");
  const taskInput = TaskInputSchema.safeParse(task.input);
  if (!taskInput.success) throw new TerminalJobError("TASK_INPUT_INVALID", "research task input does not match its contract");

  const agentTask: AgentTask = {
    taskId: task.id,
    campaignId: task.campaignId,
    role: "IDEA_SCOUT",
    objective: taskInput.data.objective,
    constraints: ["Return exactly one Idea Card JSON object.", "Pine Script v6 feasibility must be assessed.", "Do not claim evidence you do not cite."],
    untrustedContext: [],
  };
  const outcome: RunOutcome<IdeaCard> = await runStructured({ provider: deps.provider, role: "IDEA_SCOUT", systemPrompt: prompt.content, input: agentTask, outputSchema: IdeaCardSchema });
  instruments.modelCostUsd.add(Number(outcome.usage.costUsd), { role: "IDEA_SCOUT", provider: outcome.provider });
  if (outcome.status === "FAILED_VALIDATION") instruments.modelSchemaFailures.add(1, { role: "IDEA_SCOUT" });

  const rawBytes = new TextEncoder().encode(canonicalJson({ agentRunId: run.id, provider: outcome.provider, model: outcome.model, rawOutputs: outcome.rawOutputs }));
  const rawArtefactId = await storeObject(deps.db, deps.store, {
    organisationId: org,
    kind: "AGENT_RAW_OUTPUT",
    key: objectPaths.agentRawOutput(org, task.campaignId, run.id, sha256Hex(rawBytes)),
    bytes: rawBytes,
    protection: "PROTECTED",
  });
  let outputArtefactId: string | null = null;
  if (outcome.status === "SUCCEEDED") {
    const cardBytes = new TextEncoder().encode(canonicalJson(outcome.output));
    outputArtefactId = await storeObject(deps.db, deps.store, {
      organisationId: org,
      kind: "IDEA_CARD",
      key: objectPaths.ideaCard(org, task.campaignId, sha256Hex(cardBytes)),
      bytes: cardBytes,
      protection: "STANDARD",
    });
  }

  await deps.db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, run.id)).for("update");
    if (locked?.status !== "RUNNING") return;
    let ideaCardId: string | null = null;
    if (outcome.status === "SUCCEEDED" && outputArtefactId) {
      ideaCardId = uuidv7();
      await tx.insert(ideaCards).values({
        id: ideaCardId,
        organisationId: org,
        campaignId: task.campaignId,
        taskId: task.id,
        agentRunId: run.id,
        artefactId: outputArtefactId,
        title: outcome.output.title,
        recommendation: outcome.output.recommendation,
        content: outcome.output,
      });
      const handoff = HandoffSchema.parse({
        schemaVersion: "1.0.0",
        handoffId: uuidv7(),
        campaignId: task.campaignId,
        strategyId: null,
        strategyVersionId: null,
        fromAgent: { role: "IDEA_SCOUT", agentId: `${outcome.provider}/${outcome.model}`, promptVersion: prompt.contentHash },
        toRole: "STRATEGY_ARCHITECT",
        taskId: task.id,
        status: "COMPLETE",
        summary: outcome.output.summary,
        assumptions: [],
        unknowns: [],
        riskFlags: outcome.output.risks,
        artefactIds: [outputArtefactId],
        evidenceIds: [ideaCardId],
        requestedAction: "Review the idea card and decide whether to draft a Strategy Definition.",
        createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
      await tx.insert(handoffs).values({ id: handoff.handoffId, organisationId: org, campaignId: task.campaignId, taskId: task.id, agentRunId: run.id, fromRole: "IDEA_SCOUT", toRole: handoff.toRole, status: handoff.status, payload: handoff });
      await appendAudit(tx, {
        organisationId: org,
        actorType: SERVICE_ACTOR.type,
        actorId: SERVICE_ACTOR.id,
        action: "IDEA_CARD_CREATED",
        aggregateType: "IDEA_CARD",
        aggregateId: ideaCardId,
        priorState: null,
        newState: { taskId: task.id, agentRunId: run.id, recommendation: outcome.output.recommendation, artefactId: outputArtefactId },
        reason: "validated IDEA_SCOUT output",
        traceId: job.traceId,
      });
    }
    await tx
      .update(agentRuns)
      .set({
        status: outcome.status,
        provider: outcome.provider,
        model: outcome.model,
        attempts: outcome.attempts,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        costUsd: outcome.usage.costUsd,
        outputArtefactId,
        rawOutputArtefactId: rawArtefactId,
        errorCode: outcome.status === "SUCCEEDED" ? null : outcome.status === "FAILED_PROVIDER" ? outcome.errorCode : "SCHEMA_VALIDATION_FAILED",
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id));
    await appendAudit(tx, {
      organisationId: org,
      actorType: SERVICE_ACTOR.type,
      actorId: SERVICE_ACTOR.id,
      action: "AGENT_RUN_RECORDED",
      aggregateType: "AGENT_RUN",
      aggregateId: run.id,
      priorState: { status: "RUNNING" },
      // Validation issue text can echo model output, so only counts are audited.
      newState: { status: outcome.status, attempts: outcome.attempts, provider: outcome.provider, model: outcome.model, costUsd: outcome.usage.costUsd, issueCount: outcome.status === "FAILED_VALIDATION" ? outcome.issues.length : 0 },
      reason: `IDEA_SCOUT run ${outcome.status}`,
      traceId: job.traceId,
    });
    await enqueueOutbox(tx, {
      eventId: deterministicUuid(`agent_run.completed|${run.id}`),
      organisationId: org,
      eventType: "agent_run.completed",
      aggregateType: "AGENT_RUN",
      aggregateId: run.id,
      correlationId: job.correlationId,
      causationId: job.eventId,
      actor: SERVICE_ACTOR,
      traceId: job.traceId,
      payload: { taskId: task.id, agentRunId: run.id, ideaCardId },
    });
  });
}

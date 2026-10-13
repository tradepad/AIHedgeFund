import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import {
  IdeaCardSchema,
  canonicalJson,
  uuidv7,
  type Campaign,
  type CampaignSummary,
  type CreateCampaignRequest,
  type IdeaCard,
  type IdeaCardRecord,
  type ResearchTask,
} from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import { loadApprovedPrompt } from "@arf/agent-runtime";
import {
  agentRuns,
  campaigns,
  ideaCards,
  researchTasks,
  strategies,
  strategyVersions,
  type DbOrTx,
  type Tx,
} from "@arf/db";
import { objectPaths } from "@arf/storage";
import type { AppContext, RequestScope } from "../context";
import { problems } from "../http/problem";
import { IdCursor, decodeCursor, page } from "../http/pagination";
import { audit, emit, iso, storeArtefact, utf8 } from "./common";
import { applyTransition } from "./transitions";

export function toCampaign(row: typeof campaigns.$inferSelect): Campaign {
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    assetClasses: row.assetClasses,
    timeframes: row.timeframes,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

export async function loadCampaign(
  db: DbOrTx,
  scope: RequestScope,
  id: string,
  lock = false,
): Promise<typeof campaigns.$inferSelect> {
  const q = db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.organisationId, scope.principal.organisationId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw problems.notFound("campaign");
  return row;
}

export async function createCampaign(
  tx: Tx,
  scope: RequestScope,
  body: CreateCampaignRequest,
): Promise<Campaign> {
  const id = uuidv7();
  const [row] = await tx
    .insert(campaigns)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      name: body.name,
      objective: body.objective,
      assetClasses: body.assetClasses,
      timeframes: body.timeframes,
      createdBy: scope.principal.userId,
    })
    .returning();
  if (!row) throw new Error("campaign insert returned no row");
  await audit(tx, scope, {
    action: "CAMPAIGN_CREATED",
    aggregateType: "CAMPAIGN",
    aggregateId: id,
    newState: { name: body.name, status: "ACTIVE" },
    reason: "campaign created",
  });
  await emit(tx, scope, {
    eventType: "campaign.created",
    aggregateType: "CAMPAIGN",
    aggregateId: id,
    payload: { campaignId: id },
  });
  return toCampaign(row);
}

export async function listCampaigns(
  ctx: AppContext,
  scope: RequestScope,
  q: { cursor?: string | undefined; limit: number },
) {
  const cursor = decodeCursor(IdCursor, q.cursor);
  const rows = await ctx.db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organisationId, scope.principal.organisationId),
        cursor ? lt(campaigns.id, cursor.id) : undefined,
      ),
    )
    .orderBy(desc(campaigns.id))
    .limit(q.limit + 1);
  const p = page(rows, q.limit, (r) => ({ id: r.id }));
  return { items: p.items.map(toCampaign), nextCursor: p.nextCursor };
}

export async function getCampaignSummary(
  ctx: AppContext,
  scope: RequestScope,
  id: string,
): Promise<CampaignSummary> {
  const row = await loadCampaign(ctx.db, scope, id);
  const org = scope.principal.organisationId;
  const [strategyCount] = await ctx.db
    .select({ n: count() })
    .from(strategies)
    .where(and(eq(strategies.organisationId, org), eq(strategies.campaignId, id)));
  const [taskCount] = await ctx.db
    .select({ n: count() })
    .from(researchTasks)
    .where(and(eq(researchTasks.organisationId, org), eq(researchTasks.campaignId, id)));
  const byState = await ctx.db
    .select({ state: strategyVersions.state, n: count() })
    .from(strategyVersions)
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .where(and(eq(strategyVersions.organisationId, org), eq(strategies.campaignId, id)))
    .groupBy(strategyVersions.state);
  return {
    ...toCampaign(row),
    strategyCount: strategyCount?.n ?? 0,
    taskCount: taskCount?.n ?? 0,
    versionCountsByState: Object.fromEntries(byState.map((r) => [r.state, r.n])),
  };
}

export function toTask(row: typeof researchTasks.$inferSelect): ResearchTask {
  return {
    id: row.id,
    campaignId: row.campaignId,
    role: row.role,
    title: row.title,
    state: row.state,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listTasks(
  ctx: AppContext,
  scope: RequestScope,
  campaignId: string,
): Promise<ResearchTask[]> {
  await loadCampaign(ctx.db, scope, campaignId);
  const rows = await ctx.db
    .select()
    .from(researchTasks)
    .where(
      and(
        eq(researchTasks.organisationId, scope.principal.organisationId),
        eq(researchTasks.campaignId, campaignId),
      ),
    )
    .orderBy(desc(researchTasks.id))
    .limit(200);
  return rows.map(toTask);
}

export function toIdeaRecord(row: typeof ideaCards.$inferSelect): IdeaCardRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    taskId: row.taskId,
    agentRunId: row.agentRunId,
    artefactId: row.artefactId,
    ideaCard: IdeaCardSchema.parse(row.content),
    createdAt: iso(row.createdAt),
  };
}

export async function listIdeas(
  ctx: AppContext,
  scope: RequestScope,
  campaignId: string,
): Promise<IdeaCardRecord[]> {
  await loadCampaign(ctx.db, scope, campaignId);
  const rows = await ctx.db
    .select()
    .from(ideaCards)
    .where(
      and(
        eq(ideaCards.organisationId, scope.principal.organisationId),
        eq(ideaCards.campaignId, campaignId),
      ),
    )
    .orderBy(desc(ideaCards.id));
  return rows.map(toIdeaRecord);
}

export async function getIdea(
  ctx: AppContext,
  scope: RequestScope,
  id: string,
): Promise<IdeaCardRecord> {
  const [row] = await ctx.db
    .select()
    .from(ideaCards)
    .where(and(eq(ideaCards.organisationId, scope.principal.organisationId), eq(ideaCards.id, id)));
  if (!row) throw problems.notFound("idea card");
  return toIdeaRecord(row);
}

async function createTask(
  tx: Tx,
  scope: RequestScope,
  campaignId: string,
  title: string,
  input: Record<string, unknown>,
): Promise<string> {
  const taskId = uuidv7();
  await tx.insert(researchTasks).values({
    id: taskId,
    organisationId: scope.principal.organisationId,
    campaignId,
    role: "IDEA_SCOUT",
    title,
    state: "CAMPAIGN_BACKLOG",
    input,
    createdBy: scope.principal.userId,
  });
  await audit(tx, scope, {
    action: "RESEARCH_TASK_CREATED",
    aggregateType: "RESEARCH_TASK",
    aggregateId: taskId,
    newState: { state: "CAMPAIGN_BACKLOG", role: "IDEA_SCOUT" },
    reason: title,
  });
  await emit(tx, scope, {
    eventType: "research_task.created",
    aggregateType: "RESEARCH_TASK",
    aggregateId: taskId,
    payload: { taskId, campaignId },
  });
  return taskId;
}

/** Store a structured Idea Card supplied by a human (validated by the route) and move its task to HYPOTHESIS_DRAFT. */
export async function ingestIdeaCard(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  campaignId: string,
  card: IdeaCard,
  key: string,
): Promise<IdeaCardRecord> {
  const campaign = await loadCampaign(tx, scope, campaignId);
  if (campaign.status !== "ACTIVE")
    throw problems.conflict("CAMPAIGN_NOT_ACTIVE", "ideas can only be added to active campaigns");
  const taskId = await createTask(tx, scope, campaignId, card.title, { source: "MANUAL" });
  await applyTransition(ctx, tx, scope, {
    aggregate: "RESEARCH_TASK",
    aggregateId: taskId,
    from: "CAMPAIGN_BACKLOG",
    to: "IDEA_RESEARCH",
    reasonCodes: ["MANUAL_IDEA"],
    summary: "manual idea card submitted",
    evidenceIds: [],
    key: `${key}-start`,
  });
  const bytes = utf8(canonicalJson(card));
  const artefact = await storeArtefact(tx, ctx.store, {
    organisationId: scope.principal.organisationId,
    kind: "IDEA_CARD",
    key: objectPaths.ideaCard(scope.principal.organisationId, campaignId, sha256Hex(bytes)),
    bytes,
    contentType: "application/json",
    createdBy: scope.principal.userId,
  });
  const id = uuidv7();
  const [row] = await tx
    .insert(ideaCards)
    .values({
      id,
      organisationId: scope.principal.organisationId,
      campaignId,
      taskId,
      agentRunId: null,
      artefactId: artefact.id,
      title: card.title,
      recommendation: card.recommendation,
      content: card,
    })
    .returning();
  if (!row) throw new Error("idea card insert returned no row");
  await audit(tx, scope, {
    action: "IDEA_CARD_CREATED",
    aggregateType: "IDEA_CARD",
    aggregateId: id,
    newState: { taskId, recommendation: card.recommendation, artefactId: artefact.id },
    reason: "manual idea card",
  });
  await applyTransition(ctx, tx, scope, {
    aggregate: "RESEARCH_TASK",
    aggregateId: taskId,
    from: "IDEA_RESEARCH",
    to: "HYPOTHESIS_DRAFT",
    reasonCodes: ["IDEA_CARD_RECORDED"],
    summary: "structured idea card recorded",
    evidenceIds: [id],
    key: `${key}-draft`,
  });
  return toIdeaRecord(row);
}

/**
 * Request an IDEA_SCOUT run. The model runs in worker-research; this command
 * only records the task and the pending run. The model never transitions
 * state: the orchestrator does, after validating the stored output.
 */
export async function requestIdeaGeneration(
  ctx: AppContext,
  tx: Tx,
  scope: RequestScope,
  campaignId: string,
  objective: string,
  key: string,
): Promise<{ taskId: string; agentRunId: string }> {
  const campaign = await loadCampaign(tx, scope, campaignId);
  if (campaign.status !== "ACTIVE")
    throw problems.conflict(
      "CAMPAIGN_NOT_ACTIVE",
      "ideas can only be generated for active campaigns",
    );
  const prompt = await loadApprovedPrompt(tx, "IDEA_SCOUT");
  if (!prompt)
    throw problems.conflict("PROMPT_NOT_APPROVED", "no approved IDEA_SCOUT prompt is registered");
  const taskId = await createTask(tx, scope, campaignId, `Idea Scout: ${objective.slice(0, 80)}`, {
    source: "IDEA_SCOUT",
    objective,
    campaignObjective: campaign.objective,
  });
  await applyTransition(ctx, tx, scope, {
    aggregate: "RESEARCH_TASK",
    aggregateId: taskId,
    from: "CAMPAIGN_BACKLOG",
    to: "IDEA_RESEARCH",
    reasonCodes: ["AGENT_REQUESTED"],
    summary: "IDEA_SCOUT run requested",
    evidenceIds: [],
    key: `${key}-start`,
  });
  const agentRunId = uuidv7();
  await tx.insert(agentRuns).values({
    id: agentRunId,
    organisationId: scope.principal.organisationId,
    taskId,
    role: "IDEA_SCOUT",
    promptVersionId: prompt.id,
    provider: "pending",
    model: "pending",
    status: "RUNNING",
    idempotencyKey: `agent-run-${taskId}`,
  });
  await emit(tx, scope, {
    eventType: "agent_run.requested",
    aggregateType: "AGENT_RUN",
    aggregateId: agentRunId,
    payload: { taskId, agentRunId },
  });
  return { taskId, agentRunId };
}

export async function campaignAggregateIds(
  db: DbOrTx,
  scope: RequestScope,
  campaignId: string,
): Promise<string[]> {
  const org = scope.principal.organisationId;
  const tasks = await db
    .select({ id: researchTasks.id })
    .from(researchTasks)
    .where(and(eq(researchTasks.organisationId, org), eq(researchTasks.campaignId, campaignId)));
  const ideas = await db
    .select({ id: ideaCards.id })
    .from(ideaCards)
    .where(and(eq(ideaCards.organisationId, org), eq(ideaCards.campaignId, campaignId)));
  const strats = await db
    .select({ id: strategies.id })
    .from(strategies)
    .where(and(eq(strategies.organisationId, org), eq(strategies.campaignId, campaignId)));
  const versions =
    strats.length === 0
      ? []
      : await db
          .select({ id: strategyVersions.id })
          .from(strategyVersions)
          .where(
            and(
              eq(strategyVersions.organisationId, org),
              inArray(
                strategyVersions.strategyId,
                strats.map((s) => s.id),
              ),
            ),
          );
  const runs =
    tasks.length === 0
      ? []
      : await db
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.organisationId, org),
              inArray(
                agentRuns.taskId,
                tasks.map((t) => t.id),
              ),
            ),
          );
  return [campaignId, ...tasks, ...ideas, ...strats, ...versions, ...runs].map((x) =>
    typeof x === "string" ? x : x.id,
  );
}

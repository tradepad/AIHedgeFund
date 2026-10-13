import type { FastifyInstance } from "fastify";
import {
  CreateCampaignRequestSchema,
  CreateStrategyRequestSchema,
  CreateStrategyVersionRequestSchema,
  GenerateIdeaRequestSchema,
  IngestIdeaCardRequestSchema,
  PutPineRevisionRequestSchema,
  PutStrategyDefinitionRequestSchema,
  TransitionRequestSchema,
} from "@arf/contracts";
import { z } from "zod";
import type { AppContext } from "../context";
import { authorise } from "../http/auth";
import { runIdempotent } from "../http/idempotency";
import * as campaigns from "../services/campaigns";
import * as registry from "../services/registry";
import { listTransitions, transitionVersion } from "../services/transitions";
import { aggregateAuditTimeline } from "../services/oversight";
import { IdParams, PageQuery } from "./shared";

export function researchRoutes(app: FastifyInstance, ctx: AppContext): void {
  // --- Campaigns -----------------------------------------------------------
  app.post("/v1/campaigns", async (request, reply) => {
    const scope = authorise(request, "campaign:write");
    const body = CreateCampaignRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "campaign.create", body, async (tx) => ({ status: 201, body: await campaigns.createCampaign(tx, scope, body) }));
  });

  app.get("/v1/campaigns", async (request) => {
    const scope = authorise(request, "read");
    return campaigns.listCampaigns(ctx, scope, PageQuery.parse(request.query));
  });

  app.get("/v1/campaigns/:id", async (request) => {
    const scope = authorise(request, "read");
    return campaigns.getCampaignSummary(ctx, scope, IdParams.parse(request.params).id);
  });

  app.get("/v1/campaigns/:id/tasks", async (request) => {
    const scope = authorise(request, "read");
    return { items: await campaigns.listTasks(ctx, scope, IdParams.parse(request.params).id) };
  });

  app.get("/v1/campaigns/:id/ideas", async (request) => {
    const scope = authorise(request, "read");
    return { items: await campaigns.listIdeas(ctx, scope, IdParams.parse(request.params).id) };
  });

  app.get("/v1/campaigns/:id/audit", async (request) => {
    const scope = authorise(request, "read");
    const { id } = IdParams.parse(request.params);
    await campaigns.loadCampaign(ctx.db, scope, id);
    const ids = await campaigns.campaignAggregateIds(ctx.db, scope, id);
    return aggregateAuditTimeline(ctx, scope, ids, PageQuery.parse(request.query));
  });

  app.post("/v1/campaigns/:id/ideas", async (request, reply) => {
    const scope = authorise(request, "idea:write");
    const { id } = IdParams.parse(request.params);
    const body = IngestIdeaCardRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "idea.ingest", { id, body }, async (tx, key) => ({
      status: 201,
      body: await campaigns.ingestIdeaCard(ctx, tx, scope, id, body.ideaCard, key),
    }));
  });

  app.post("/v1/campaigns/:id/ideas/generate", async (request, reply) => {
    const scope = authorise(request, "idea:write");
    const { id } = IdParams.parse(request.params);
    const body = GenerateIdeaRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "idea.generate", { id, body }, async (tx, key) => ({
      status: 202,
      body: await campaigns.requestIdeaGeneration(ctx, tx, scope, id, body.objective, key),
    }));
  });

  app.get("/v1/ideas/:id", async (request) => {
    const scope = authorise(request, "read");
    return campaigns.getIdea(ctx, scope, IdParams.parse(request.params).id);
  });

  // --- Strategies and immutable versions ------------------------------------
  app.post("/v1/strategies", async (request, reply) => {
    const scope = authorise(request, "strategy:write");
    const body = CreateStrategyRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "strategy.create", body, async (tx) => ({ status: 201, body: await registry.createStrategy(tx, scope, body) }));
  });

  app.get("/v1/strategies/:id", async (request) => {
    const scope = authorise(request, "read");
    return registry.getStrategy(ctx, scope, IdParams.parse(request.params).id);
  });

  app.post("/v1/strategies/:id/versions", async (request, reply) => {
    const scope = authorise(request, "strategy:write");
    const { id } = IdParams.parse(request.params);
    const body = CreateStrategyVersionRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "version.create", { id, body }, async (tx) => ({ status: 201, body: await registry.createVersion(tx, scope, id, body) }));
  });

  app.get("/v1/strategy-versions/:id", async (request) => {
    const scope = authorise(request, "read");
    return registry.getVersion(ctx, scope, IdParams.parse(request.params).id);
  });

  app.get("/v1/strategy-versions/:id/lineage", async (request) => {
    const scope = authorise(request, "read");
    return { items: await registry.getLineage(ctx, scope, IdParams.parse(request.params).id) };
  });

  app.put("/v1/strategy-versions/:id/definition", async (request, reply) => {
    const scope = authorise(request, "strategy:write");
    const { id } = IdParams.parse(request.params);
    const body = PutStrategyDefinitionRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "definition.put", { id, body }, async (tx) => ({ status: 201, body: await registry.putDefinition(ctx, tx, scope, id, body.definition) }));
  });

  app.get("/v1/strategy-versions/:id/definition", async (request) => {
    const scope = authorise(request, "read");
    return registry.getDefinition(ctx, scope, IdParams.parse(request.params).id);
  });

  app.get("/v1/strategy-versions/:id/pine/template", async (request) => {
    const scope = authorise(request, "read");
    const q = z
      .object({ initialCapital: z.coerce.number().positive().max(1e12).default(10000), currency: z.string().regex(/^[A-Z]{3,5}$/).default("USD") })
      .parse(request.query);
    return registry.pineTemplate(ctx, scope, IdParams.parse(request.params).id, q);
  });

  app.put("/v1/strategy-versions/:id/pine", async (request, reply) => {
    const scope = authorise(request, "pine:write");
    const { id } = IdParams.parse(request.params);
    const body = PutPineRevisionRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "pine.put", { id, body }, async (tx) => ({ status: 201, body: await registry.putPineRevision(ctx, tx, scope, id, body) }));
  });

  app.get("/v1/strategy-versions/:id/pine", async (request) => {
    const scope = authorise(request, "read");
    return registry.getPineRevision(ctx, scope, IdParams.parse(request.params).id);
  });

  app.post("/v1/strategy-versions/:id/transitions", async (request, reply) => {
    const scope = authorise(request, "workflow:transition");
    const { id } = IdParams.parse(request.params);
    const body = TransitionRequestSchema.parse(request.body);
    return runIdempotent(ctx, request, reply, scope, "version.transition", { id, body }, async (tx, key) => ({
      status: 200,
      body: await transitionVersion(ctx, tx, scope, id, body, key),
    }));
  });

  app.get("/v1/strategy-versions/:id/transitions", async (request) => {
    const scope = authorise(request, "read");
    const { id } = IdParams.parse(request.params);
    await registry.loadVersion(ctx.db, scope, id);
    return { items: await listTransitions(ctx, scope, id) };
  });
}

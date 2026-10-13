"use client";

import { field } from "@/lib/form";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  GenerateIdeaResultSchema,
  IdeaCardRecordSchema,
  IdeaCardSchema,
  StrategySchema,
} from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";

export function CampaignActions({
  campaignId,
  ideas,
  ideaTemplate,
}: {
  campaignId: string;
  ideas: { id: string; title: string }[];
  ideaTemplate: string;
}) {
  const router = useRouter();
  const ingest = useCommand("POST", IdeaCardRecordSchema);
  const generate = useCommand("POST", GenerateIdeaResultSchema);
  const createStrategy = useCommand("POST", StrategySchema);
  const [ideaJson, setIdeaJson] = useState(ideaTemplate);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitIdea(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(ideaJson);
    } catch {
      setLocalError("Idea Card is not valid JSON");
      return;
    }
    const card = IdeaCardSchema.safeParse(parsed);
    if (!card.success) {
      setLocalError(card.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    if (await ingest.run(`/v1/campaigns/${campaignId}/ideas`, { ideaCard: card.data }))
      router.refresh();
  }

  async function submitGenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await generate.run(`/v1/campaigns/${campaignId}/ideas/generate`, {
        objective: field(f, "objective"),
      })
    )
      router.refresh();
  }

  async function submitStrategy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ideaCardId = field(f, "ideaCardId");
    const created = await createStrategy.run("/v1/strategies", {
      campaignId,
      name: field(f, "name"),
      family: field(f, "family"),
      ...(ideaCardId ? { ideaCardId } : {}),
    });
    if (created) router.push(`/strategies/${created.id}`);
  }

  return (
    <div className="grid grid-2">
      <form className="card stack" onSubmit={(e) => void submitIdea(e)} aria-label="Add idea card">
        <h2>Add a structured Idea Card</h2>
        <p className="muted">
          The template below is an editable example; replace every field with your own idea.
          Structured fields are canonical.
        </p>
        <textarea
          rows={14}
          value={ideaJson}
          onChange={(e) => setIdeaJson(e.target.value)}
          aria-label="Idea Card JSON"
        />
        {localError ? (
          <div className="notice bad" role="alert">
            {localError}
          </div>
        ) : null}
        <ProblemInline problem={ingest.problem} />
        <div>
          <button type="submit" disabled={ingest.pending}>
            Record idea
          </button>
        </div>
      </form>
      <div className="stack">
        <form
          className="card stack"
          onSubmit={(e) => void submitGenerate(e)}
          aria-label="Generate idea"
        >
          <h2>Ask IDEA_SCOUT</h2>
          <p className="muted">
            Runs the approved IDEA_SCOUT prompt in the research worker. Output is validated against
            the Idea Card contract before it is recorded.
          </p>
          <label>
            Objective
            <input
              name="objective"
              required
              minLength={10}
              defaultValue=""
              placeholder="e.g. trend continuation on BTC perpetuals"
            />
          </label>
          <ProblemInline problem={generate.problem} />
          <div>
            <button type="submit" className="secondary" disabled={generate.pending}>
              Request idea
            </button>
          </div>
        </form>
        <form
          className="card stack"
          onSubmit={(e) => void submitStrategy(e)}
          aria-label="Create strategy"
        >
          <h2>New strategy</h2>
          <label>
            Name
            <input name="name" required minLength={3} />
          </label>
          <label>
            Family (snake_case)
            <input
              name="family"
              required
              pattern="[a-z][a-z0-9_]*"
              defaultValue="trend_following"
            />
          </label>
          <label>
            From idea
            <select name="ideaCardId" defaultValue="">
              <option value="">No linked idea</option>
              {ideas.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </label>
          <ProblemInline problem={createStrategy.problem} />
          <div>
            <button type="submit" disabled={createStrategy.pending}>
              Create strategy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

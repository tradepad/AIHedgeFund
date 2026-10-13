"use client";

import { field } from "@/lib/form";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChangeCategorySchema, StrategyVersionSchema } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";

interface Parent {
  id: string;
  label: string;
  symbol: string;
  timeframe: string;
}

export function CreateVersion({ strategyId, parents }: { strategyId: string; parents: Parent[] }) {
  const router = useRouter();
  const { run, pending, problem } = useCommand("POST", StrategyVersionSchema);
  const isRoot = parents.length === 0;
  const last = parents.at(-1);
  const [categories, setCategories] = useState<string[]>([]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const common = { symbol: field(f, "symbol"), timeframe: field(f, "timeframe"), changeReason: field(f, "changeReason") };
    const body = isRoot
      ? { kind: "ROOT", ...common }
      : {
          kind: "CHILD",
          ...common,
          parentVersionId: field(f, "parentVersionId"),
          changeCategories: categories,
          changedFields: field(f, "changedFields")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          motivatingEvidenceIds: [],
          contaminatedData: field(f, "contaminatedData")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
    const created = await run(`/v1/strategies/${strategyId}/versions`, body);
    if (created) router.push(`/versions/${created.id}`);
  }

  return (
    <form className="card stack" onSubmit={(e) => void onSubmit(e)} aria-label="Create version">
      <h2>{isRoot ? "Create root version" : "Create child version"}</h2>
      <p className="muted">Versions are immutable. Any change to source, parameters, market, costs or execution creates a child version with an explicit reason.</p>
      {!isRoot ? (
        <label>
          Parent
          <select name="parentVersionId" defaultValue={last?.id}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="row">
        <label>
          Symbol (EXCHANGE:TICKER)
          <input name="symbol" required defaultValue={last?.symbol ?? ""} placeholder="BYBIT:BTCUSDT.P" />
        </label>
        <label>
          Timeframe
          <input name="timeframe" required defaultValue={last?.timeframe ?? ""} placeholder="60" size={6} />
        </label>
      </div>
      <label>
        Reason
        <input name="changeReason" required minLength={3} defaultValue={isRoot ? "initial hypothesis" : ""} />
      </label>
      {!isRoot ? (
        <>
          <fieldset className="row">
            <legend className="muted">Change categories</legend>
            {ChangeCategorySchema.options.map((c) => (
              <label key={c} className="inline">
                <input type="checkbox" checked={categories.includes(c)} onChange={(e) => setCategories((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c)))} />
                {c.toLowerCase()}
              </label>
            ))}
          </fieldset>
          <label>
            Changed fields (comma separated)
            <input name="changedFields" required />
          </label>
          <label>
            Data already seen while designing this change (contaminated; comma separated)
            <input name="contaminatedData" />
          </label>
        </>
      ) : null}
      <ProblemInline problem={problem} />
      <div>
        <button type="submit" disabled={pending}>
          Create version
        </button>
      </div>
    </form>
  );
}

"use client";

import { field } from "@/lib/form";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CampaignSchema } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";

const ASSET_CLASSES = ["crypto", "equity", "fx", "futures", "index", "commodity"] as const;

export function CreateCampaign() {
  const router = useRouter();
  const { run, pending, problem } = useCommand("POST", CampaignSchema);
  const [assets, setAssets] = useState<string[]>(["crypto"]);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const created = await run("/v1/campaigns", {
      name: field(f, "name"),
      objective: field(f, "objective"),
      assetClasses: assets,
      timeframes: field(f, "timeframes")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (created) router.push(`/campaigns/${created.id}`);
  }
  return (
    <form className="card stack" onSubmit={(e) => void onSubmit(e)} aria-label="Create campaign">
      <h2>New campaign</h2>
      <label>
        Name
        <input name="name" required minLength={3} maxLength={120} />
      </label>
      <label>
        Objective
        <textarea name="objective" required minLength={10} rows={3} />
      </label>
      <fieldset className="row">
        <legend className="muted">Asset classes</legend>
        {ASSET_CLASSES.map((a) => (
          <label key={a} className="inline">
            <input type="checkbox" checked={assets.includes(a)} onChange={(e) => setAssets((xs) => (e.target.checked ? [...xs, a] : xs.filter((x) => x !== a)))} />
            {a}
          </label>
        ))}
      </fieldset>
      <label>
        Timeframes (TradingView notation, comma separated)
        <input name="timeframes" defaultValue="60" required />
      </label>
      <ProblemInline problem={problem} />
      <div>
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create campaign"}
        </button>
      </div>
    </form>
  );
}

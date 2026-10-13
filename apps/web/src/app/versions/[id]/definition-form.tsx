"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StrategyDefinitionRecordSchema, StrategyDefinitionSchema } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";

export function DefinitionForm({ versionId, template }: { versionId: string; template: string }) {
  const router = useRouter();
  const { run, pending, problem } = useCommand("PUT", StrategyDefinitionRecordSchema);
  const [text, setText] = useState(template);
  const [issues, setIssues] = useState<string[]>([]);
  async function submit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setIssues(["not valid JSON"]);
      return;
    }
    const sdl = StrategyDefinitionSchema.safeParse(parsed);
    if (!sdl.success) {
      setIssues(sdl.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      return;
    }
    setIssues([]);
    if (await run(`/v1/strategy-versions/${versionId}/definition`, { definition: sdl.data })) router.refresh();
  }
  return (
    <section className="card stack">
      <h2>Attach Strategy Definition (SDL 1.0.0)</h2>
      <p className="muted">Prefilled with the documented example adapted to this version&apos;s symbol and timeframe. Edit it to describe your strategy. Once attached it is write-once.</p>
      <textarea rows={28} value={text} onChange={(e) => setText(e.target.value)} aria-label="Strategy Definition JSON" />
      {issues.length > 0 ? (
        <ul className="notice bad" role="alert">
          {issues.slice(0, 10).map((i) => (
            <li key={i} className="mono">
              {i}
            </li>
          ))}
        </ul>
      ) : null}
      <ProblemInline problem={problem} />
      <div>
        <button type="button" onClick={() => void submit()} disabled={pending} data-testid="attach-sdl">
          Validate and attach
        </button>
      </div>
    </section>
  );
}

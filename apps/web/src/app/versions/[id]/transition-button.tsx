"use client";

import { useRouter } from "next/navigation";
import type { WorkflowState } from "@arf/contracts";
import { TransitionResultSchema } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";
import { clientGet } from "@/lib/client-api";
import { z } from "zod";

const EvidenceIdsSchema = z.object({ id: z.uuid() });

/**
 * Request a lifecycle transition. The workflow engine on the server decides;
 * the button only offers the next step. Evidence ids are the version's own
 * definition and Pine revision where the transition needs them.
 */
export function TransitionButton({ versionId, to, label, reasonCode, summary, secondary }: { versionId: string; to: WorkflowState; label: string; reasonCode: string; summary: string; secondary?: boolean }) {
  const router = useRouter();
  const { run, pending, problem } = useCommand("POST", TransitionResultSchema);
  async function onClick() {
    const evidenceIds: string[] = [];
    if (to === "PINE_DEVELOPMENT" || to === "TRADINGVIEW_VERIFICATION") {
      const sdl = await clientGet(`/v1/strategy-versions/${versionId}/definition`, EvidenceIdsSchema);
      if (sdl.ok) evidenceIds.push(sdl.data.id);
    }
    if (to === "TRADINGVIEW_VERIFICATION") {
      const pine = await clientGet(`/v1/strategy-versions/${versionId}/pine`, EvidenceIdsSchema);
      if (pine.ok) evidenceIds.push(pine.data.id);
    }
    if (await run(`/v1/strategy-versions/${versionId}/transitions`, { to, reasonCodes: [reasonCode], summary, evidenceIds })) router.refresh();
  }
  return (
    <div className="stack">
      <div>
        <button type="button" className={secondary ? "secondary" : undefined} disabled={pending} onClick={() => void onClick()} data-testid={`transition-${to}`}>
          {label}
        </button>
      </div>
      <ProblemInline problem={problem} />
    </div>
  );
}

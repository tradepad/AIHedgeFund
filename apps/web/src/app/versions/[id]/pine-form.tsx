"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PineManifestSchema,
  PineRevisionRecordSchema,
  PineTemplateViewSchema,
  type PineTemplateView,
} from "@arf/contracts";
import { Badge } from "@arf/ui";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";
import { clientGet, type ClientResult } from "@/lib/client-api";

/**
 * Generate Pine from the approved template for this version's SDL, review it
 * and its static checks, optionally edit, then attach. The server re-runs the
 * linter and refuses hard errors.
 */
export function PineForm({ versionId }: { versionId: string }) {
  const router = useRouter();
  const attach = useCommand("PUT", PineRevisionRecordSchema);
  const [capital, setCapital] = useState("10000");
  const [currency, setCurrency] = useState("USDT");
  const [template, setTemplate] = useState<ClientResult<PineTemplateView> | null>(null);
  const [source, setSource] = useState("");
  const [manifestText, setManifestText] = useState("");
  const [manifestError, setManifestError] = useState<string | null>(null);

  async function generate() {
    const res = await clientGet(
      `/v1/strategy-versions/${versionId}/pine/template?initialCapital=${encodeURIComponent(capital)}&currency=${encodeURIComponent(currency)}`,
      PineTemplateViewSchema,
    );
    setTemplate(res);
    if (res.ok) {
      setSource(res.data.source);
      setManifestText(JSON.stringify(res.data.manifest, null, 2));
    }
  }

  async function submit() {
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      setManifestError("manifest is not valid JSON");
      return;
    }
    const parsed = PineManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      setManifestError(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
      return;
    }
    setManifestError(null);
    if (
      await attach.run(`/v1/strategy-versions/${versionId}/pine`, { source, manifest: parsed.data })
    )
      router.refresh();
  }

  return (
    <section className="card stack">
      <h2>Attach Pine v6 revision</h2>
      <div className="row">
        <label>
          Initial capital
          <input
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            inputMode="decimal"
            size={10}
          />
        </label>
        <label>
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            size={6}
          />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => void generate()}
          data-testid="generate-pine"
        >
          Generate from approved template
        </button>
      </div>
      {template && !template.ok ? <ProblemInline problem={template.problem} /> : null}
      {template?.ok ? (
        <>
          <div className="row">
            <Badge
              tone={
                template.data.lint.status === "PASS"
                  ? "good"
                  : template.data.lint.status === "WARN"
                    ? "warn"
                    : "bad"
              }
            >
              template lint {template.data.lint.status.toLowerCase()}
            </Badge>
            <span className="mono muted">sha256 {template.data.sourceHash.slice(0, 16)}…</span>
          </div>
          <label>
            Pine source
            <textarea rows={22} value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label>
            Manifest
            <textarea
              rows={12}
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
            />
          </label>
          {manifestError ? (
            <div className="notice bad" role="alert">
              {manifestError}
            </div>
          ) : null}
          <ProblemInline problem={attach.problem} />
          <div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={attach.pending}
              data-testid="attach-pine"
            >
              Lint and attach revision
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

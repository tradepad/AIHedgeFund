"use client";

import { field } from "@/lib/form";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { VerificationSchema } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";

export function CreateVerification({ versionId }: { versionId: string }) {
  const router = useRouter();
  const { run, pending, problem } = useCommand("POST", VerificationSchema);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const locale = field(f, "numberLocaleHint");
    const order = field(f, "dateOrderHint");
    const created = await run("/v1/tradingview-verifications", {
      strategyVersionId: versionId,
      chartTimezone: field(f, "chartTimezone"),
      dateFrom: field(f, "dateFrom"),
      dateTo: field(f, "dateTo"),
      barMagnifier: f.get("barMagnifier") === "on",
      ...(locale ? { numberLocaleHint: locale } : {}),
      ...(order ? { dateOrderHint: order } : {}),
    });
    if (created) router.push(`/verifications/${created.id}`);
  }
  return (
    <form
      className="card stack"
      onSubmit={(e) => void onSubmit(e)}
      aria-label="Create verification"
    >
      <h2>Create TradingView verification</h2>
      <p className="muted">
        Human-assisted: you run the Pine source in TradingView with the settings shown on the next
        screen and upload the CSV exports. No browser automation is used.
      </p>
      <label>
        Chart timezone (IANA, as set in TradingView)
        <input name="chartTimezone" required defaultValue="Etc/UTC" />
      </label>
      <div className="row">
        <label>
          From (inclusive)
          <input type="date" name="dateFrom" required />
        </label>
        <label>
          To (inclusive)
          <input type="date" name="dateTo" required />
        </label>
      </div>
      <label className="inline">
        <input type="checkbox" name="barMagnifier" /> Bar magnifier enabled
      </label>
      <div className="row">
        <label>
          Number format hint
          <select name="numberLocaleHint" defaultValue="">
            <option value="">Detect</option>
            <option value="DOT_DECIMAL">1,234.56</option>
            <option value="COMMA_DECIMAL">1.234,56</option>
          </select>
        </label>
        <label>
          Date order hint
          <select name="dateOrderHint" defaultValue="">
            <option value="">Detect</option>
            <option value="YMD">YYYY-MM-DD</option>
            <option value="DMY">DD/MM/YYYY</option>
            <option value="MDY">MM/DD/YYYY</option>
          </select>
        </label>
      </div>
      <ProblemInline problem={problem} />
      <div>
        <button type="submit" disabled={pending} data-testid="create-verification">
          Create verification
        </button>
      </div>
    </form>
  );
}

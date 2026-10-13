import Link from "next/link";
import { VerificationStatusViewSchema } from "@arf/contracts";
import { EvidenceLabel, formatDecimal } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { apiGet } from "@/lib/server-api";
import { UploadPanel } from "./upload-panel";

export const dynamic = "force-dynamic";

export default async function VerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiGet(`/v1/tradingview-verifications/${id}`, VerificationStatusViewSchema);
  if (!res.ok) return <ProblemView problem={res.problem} />;
  const { verification: v } = res.data;
  const s = v.settings;
  return (
    <div className="stack">
      <div>
        <div className="muted">
          <Link href={`/versions/${v.strategyVersionId}?tab=verification`}>← back to version</Link>
        </div>
        <h1>
          TradingView verification <EvidenceLabel kind="TRADINGVIEW" />
        </h1>
        <div className="mono muted">{v.id}</div>
      </div>
      <div className="grid grid-2">
        <section className="card">
          <h2>Reproduce these settings in TradingView</h2>
          <p className="muted">Load the exact Pine source below into the Strategy Tester, apply these properties, then export the Performance Summary and List of Trades as CSV.</p>
          <dl className="kv" data-testid="verification-settings">
            <dt>Pine source hash</dt>
            <dd className="mono" data-testid="pine-source-hash">
              {v.pineSourceHash}
            </dd>
            <dt>Symbol / timeframe</dt>
            <dd className="mono">
              {s.symbol} · {s.timeframe}
            </dd>
            <dt>Chart timezone</dt>
            <dd className="mono">{s.chartTimezone}</dd>
            <dt>Date window (inclusive)</dt>
            <dd className="mono">
              {s.dateFrom} → {s.dateTo}
            </dd>
            <dt>Initial capital</dt>
            <dd>
              {formatDecimal(s.initialCapital)} {s.currency}
            </dd>
            <dt>Commission</dt>
            <dd>
              {s.commissionValue} {s.commissionType === "percent" ? "% per side" : s.commissionType.replace(/_/g, " ")}
            </dd>
            <dt>Slippage</dt>
            <dd>{s.slippageTicks} ticks</dd>
            <dt>Order size</dt>
            <dd>
              {s.defaultQtyValue} ({s.defaultQtyType})
            </dd>
            <dt>Margin long / short</dt>
            <dd>
              {s.marginLongPct}% / {s.marginShortPct}%
            </dd>
            <dt>Pyramiding</dt>
            <dd>{s.pyramiding}</dd>
            <dt>Process orders on close</dt>
            <dd>{s.processOrdersOnClose ? "on" : "off"}</dd>
            <dt>Recalculate on every tick</dt>
            <dd>{s.calcOnEveryTick ? "on" : "off"}</dd>
            <dt>Bar magnifier</dt>
            <dd>{s.barMagnifier ? "on" : "off"}</dd>
          </dl>
        </section>
        <UploadPanel initial={res.data} />
      </div>
    </div>
  );
}

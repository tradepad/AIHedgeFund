"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import type { EquitySeries } from "@arf/contracts";
import { EvidenceLabel, formatDecimal } from "@arf/ui";

type Point = { time: UTCTimestamp; value: number };

/**
 * Chart points only. Plotting needs floats; the authoritative decimal strings
 * remain in the API response and the CSV export below. Points sharing a
 * second keep the last value, because the chart requires strictly increasing time.
 */
function toPoints(rows: { time: string; value: string }[]): Point[] {
  const byTime = new Map<number, number>();
  for (const r of rows) byTime.set(Math.floor(Date.parse(r.time) / 1000), Number(r.value));
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
}

function csv(series: EquitySeries): string {
  const lines = ["seq,time_utc,closed_equity,peak_equity,drawdown,drawdown_pct"];
  series.equity.forEach((e, i) => {
    const d = series.drawdown[i];
    lines.push(
      [e.seq, e.time, e.equity, d?.peakEquity ?? "", d?.drawdown ?? "", d?.drawdownPct ?? ""].join(
        ",",
      ),
    );
  });
  return lines.join("\n");
}

export function EquityChart({ series }: { series: EquitySeries }) {
  const equityRef = useRef<HTMLDivElement>(null);
  const drawdownRef = useRef<HTMLDivElement>(null);
  const equity = useMemo(
    () => toPoints(series.equity.map((e) => ({ time: e.time, value: e.equity }))),
    [series],
  );
  const drawdown = useMemo(
    () =>
      toPoints(series.drawdown.map((d) => ({ time: d.time, value: d.drawdownPct }))).map((p) => ({
        ...p,
        value: -p.value,
      })),
    [series],
  );

  useEffect(() => {
    const eq = equityRef.current;
    const dd = drawdownRef.current;
    if (!eq || !dd || equity.length === 0) return;
    const base = {
      height: 240,
      layout: {
        attributionLogo: false,
        background: { color: "transparent" },
        textColor: "#8f99a8",
      },
      grid: { vertLines: { color: "#2a313b" }, horzLines: { color: "#2a313b" } },
      timeScale: { timeVisible: true },
      localization: {
        timeFormatter: (t: number) =>
          new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC",
      },
    };
    const eqChart: IChartApi = createChart(eq, base);
    const ddChart: IChartApi = createChart(dd, { ...base, height: 160 });
    eqChart
      .addSeries(LineSeries, {
        color: "#2563eb",
        lineWidth: 2,
        title: `Closed equity (${series.currency})`,
      })
      .setData(equity);
    ddChart
      .addSeries(AreaSeries, {
        lineColor: "#dc2626",
        topColor: "rgba(220,38,38,0.05)",
        bottomColor: "rgba(220,38,38,0.35)",
        title: "Drawdown (% below peak)",
      })
      .setData(drawdown);
    eqChart.timeScale().fitContent();
    ddChart.timeScale().fitContent();
    // Linked brushing: zooming or panning one chart moves the other.
    let syncing = false;
    const link = (from: IChartApi, to: IChartApi) => (range: LogicalRange | null) => {
      if (syncing || !range) return;
      syncing = true;
      to.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    const a = link(eqChart, ddChart);
    const b = link(ddChart, eqChart);
    eqChart.timeScale().subscribeVisibleLogicalRangeChange(a);
    ddChart.timeScale().subscribeVisibleLogicalRangeChange(b);
    return () => {
      eqChart.remove();
      ddChart.remove();
    };
  }, [equity, drawdown, series.currency]);

  const first = series.equity[0];
  const last = series.equity.at(-1);
  const worst = series.drawdown.reduce<string | null>(
    (m, d) => (m === null || Number(d.drawdownPct) > Number(m) ? d.drawdownPct : m),
    null,
  );
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv(series)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `equity-${series.backtestRunId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!first || !last) return <p className="muted">No equity points.</p>;
  return (
    <figure className="stack" data-testid="equity-chart">
      <div className="row spread">
        <div className="row">
          <EvidenceLabel kind="SIMULATED" />
          <EvidenceLabel kind="NET" />
          <span className="muted">
            Closed-trade equity, {series.currency}. Calculation {series.calculationVersion}.
          </span>
        </div>
        <button type="button" onClick={download}>
          Export CSV
        </button>
      </div>
      <div ref={equityRef} aria-hidden="true" />
      <div ref={drawdownRef} aria-hidden="true" />
      <figcaption data-testid="equity-summary">
        Equity moved from {formatDecimal(first.equity)} to {formatDecimal(last.equity)}{" "}
        {series.currency} over {series.equity.length - 1} closed trades between{" "}
        {first.time.slice(0, 10)} and {last.time.slice(0, 10)} (UTC). Maximum drawdown{" "}
        {formatDecimal(worst)}% below the running peak. Historical simulation, not a forecast.
      </figcaption>
    </figure>
  );
}

/**
 * Generates the synthetic TradingView export fixtures in pine/fixtures/tradingview.
 *
 * The fixtures are DEVELOPMENT FIXTURES, not real exports: one deterministic
 * trade ledger rendered in two export layouts. Per-trade P&L follows the
 * declared cost model (0.06% commission per side, prices already include
 * slippage) so independent recomputation reproduces it exactly. Max drawdown
 * in the summary is set above the closed-trade drawdown, as TradingView's
 * intrabar drawdown would be.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { DateTime } from "luxon";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "pine", "fixtures", "tradingview");
mkdirSync(out, { recursive: true });

interface T {
  n: number;
  dir: "Long" | "Short";
  entry: string;
  exit: string;
  entryPrice: string;
  exitPrice: string;
  qty: string;
  entrySignal: string;
  exitSignal: string;
}

const ledger: T[] = [
  { n: 1, dir: "Long", entry: "2024-01-03T14:00", exit: "2024-01-05T09:00", entryPrice: "42350.5", exitPrice: "43890.0", qty: "0.0236", entrySignal: "L", exitSignal: "L-exit" },
  { n: 2, dir: "Short", entry: "2024-01-12T02:00", exit: "2024-01-13T18:00", entryPrice: "46120.0", exitPrice: "46980.5", qty: "0.0219", entrySignal: "S", exitSignal: "S-exit" },
  { n: 3, dir: "Long", entry: "2024-01-22T08:00", exit: "2024-01-23T11:00", entryPrice: "40110.0", exitPrice: "39420.0", qty: "0.0247", entrySignal: "L", exitSignal: "L-exit" },
  { n: 4, dir: "Long", entry: "2024-02-02T16:00", exit: "2024-02-06T04:00", entryPrice: "43005.0", exitPrice: "44710.5", qty: "0.0231", entrySignal: "L", exitSignal: "L-exit" },
  { n: 5, dir: "Short", entry: "2024-02-14T21:00", exit: "2024-02-15T07:00", entryPrice: "51800.0", exitPrice: "52650.0", qty: "0.0193", entrySignal: "S", exitSignal: "S-exit" },
  { n: 6, dir: "Long", entry: "2024-02-26T10:00", exit: "2024-02-28T13:00", entryPrice: "54100.0", exitPrice: "57950.0", qty: "0.0186", entrySignal: "L", exitSignal: "L-exit" },
  { n: 7, dir: "Long", entry: "2024-03-08T12:00", exit: "2024-03-10T06:00", entryPrice: "67200.0", exitPrice: "68420.0", qty: "0.0151", entrySignal: "L", exitSignal: "L-exit" },
  { n: 8, dir: "Short", entry: "2024-03-19T03:00", exit: "2024-03-20T22:00", entryPrice: "63950.0", exitPrice: "62110.5", qty: "0.0160", entrySignal: "S", exitSignal: "S-exit" },
  { n: 9, dir: "Long", entry: "2024-03-27T15:00", exit: "2024-03-28T01:00", entryPrice: "70010.0", exitPrice: "69100.0", qty: "0.0147", entrySignal: "L", exitSignal: "L-exit" },
  { n: 10, dir: "Short", entry: "2024-04-02T09:00", exit: "2024-04-03T17:00", entryPrice: "66080.0", exitPrice: "65310.0", qty: "0.0156", entrySignal: "S", exitSignal: "S-exit" },
  { n: 11, dir: "Short", entry: "2024-04-12T19:00", exit: "2024-04-13T21:00", entryPrice: "67400.0", exitPrice: "64010.0", qty: "0.0154", entrySignal: "S", exitSignal: "S-exit" },
  { n: 12, dir: "Long", entry: "2024-04-22T05:00", exit: "2024-04-24T14:00", entryPrice: "64950.0", exitPrice: "66310.0", qty: "0.0162", entrySignal: "L", exitSignal: "L-exit" },
];

const COMMISSION_PCT = new Decimal("0.06");
const INITIAL = new Decimal("10000");

const pnl = (t: T) => {
  const dir = t.dir === "Long" ? 1 : -1;
  const gross = new Decimal(t.exitPrice).minus(t.entryPrice).times(t.qty).times(dir);
  const commission = new Decimal(t.entryPrice).plus(t.exitPrice).times(t.qty).times(COMMISSION_PCT).div(100);
  return gross.minus(commission);
};

let cum = new Decimal(0);
let peak = INITIAL;
let maxDd = new Decimal(0);
let grossProfit = new Decimal(0);
let grossLoss = new Decimal(0);
let commissionPaid = new Decimal(0);
let wins = 0;
const rows = ledger.map((t) => {
  const p = pnl(t).toDecimalPlaces(2);
  commissionPaid = commissionPaid.plus(new Decimal(t.entryPrice).plus(t.exitPrice).times(t.qty).times(COMMISSION_PCT).div(100));
  cum = cum.plus(p);
  const equity = INITIAL.plus(cum);
  if (equity.gt(peak)) peak = equity;
  if (peak.minus(equity).gt(maxDd)) maxDd = peak.minus(equity);
  if (p.gt(0)) {
    wins++;
    grossProfit = grossProfit.plus(p);
  } else grossLoss = grossLoss.plus(p.abs());
  const notional = new Decimal(t.entryPrice).times(t.qty);
  return { t, p, pPct: p.div(notional).times(100).toDecimalPlaces(2), cum, cumPct: cum.div(INITIAL).times(100).toDecimalPlaces(2), notional };
});
const intrabarDd = maxDd.times("1.08").toDecimalPlaces(2);
const fmtUtc = (iso: string) => iso.replace("T", " ");
const fmtNy = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone("America/New_York").toFormat("dd.LL.yyyy HH:mm");
const comma = (d: Decimal | string) => new Decimal(d).toFixed().replace(".", ",");

// ---- Variant 1: classic layout, comma-delimited, dot decimal, UTC chart ----
const classic = ["Trade #,Type,Signal,Date/Time,Price USDT,Contracts,Profit USDT,Profit %,Cum. Profit USDT,Cum. Profit %,Run-up USDT,Run-up %,Drawdown USDT,Drawdown %"];
for (const r of [...rows].reverse()) {
  const d = r.t.dir;
  const common = (sig: string, time: string, price: string) =>
    `${r.t.n},${"TYPE"},${sig},${fmtUtc(time)},${price},${r.t.qty},${r.p.toFixed(2)},${r.pPct.toFixed(2)},${r.cum.toFixed(2)},${r.cumPct.toFixed(2)},0,0,0,0`;
  classic.push(common(r.t.exitSignal, r.t.exit, r.t.exitPrice).replace("TYPE", `Exit ${d}`));
  classic.push(common(r.t.entrySignal, r.t.entry, r.t.entryPrice).replace("TYPE", `Entry ${d}`));
}
writeFileSync(join(out, "classic-list-of-trades.csv"), `${classic.join("\r\n")}\r\n`);

const netProfit = cum.toFixed(2);
const longRows = rows.filter((r) => r.t.dir === "Long");
const shortRows = rows.filter((r) => r.t.dir === "Short");
const sum = (rs: typeof rows) => rs.reduce((a, r) => a.plus(r.p), new Decimal(0)).toFixed(2);
const pct = (v: string) => new Decimal(v).div(INITIAL).times(100).toDecimalPlaces(2).toFixed(2);
const summaryClassic = [
  ",All USDT,All %,Long USDT,Long %,Short USDT,Short %",
  `Net Profit,${netProfit},${pct(netProfit)},${sum(longRows)},${pct(sum(longRows))},${sum(shortRows)},${pct(sum(shortRows))}`,
  `Gross Profit,${grossProfit.toFixed(2)},${pct(grossProfit.toFixed(2))},,,,`,
  `Gross Loss,${grossLoss.toFixed(2)},${pct(grossLoss.toFixed(2))},,,,`,
  `Max Run-up,312.40,3.12,,,,`,
  `Max Drawdown,${intrabarDd.toFixed(2)},${intrabarDd.div(peak).times(100).toDecimalPlaces(2).toFixed(2)},,,,`,
  `Buy & Hold Return,5512.30,55.12,,,,`,
  `Sharpe Ratio,0.412,,,,,`,
  `Profit Factor,${grossProfit.div(grossLoss).toDecimalPlaces(3).toFixed(3)},,,,,`,
  `Commission Paid,${commissionPaid.toDecimalPlaces(2).toFixed(2)},,,,,`,
  `Total Closed Trades,${ledger.length},,${longRows.length},,${shortRows.length},`,
  `Total Open Trades,0,,0,,0,`,
  `Number Winning Trades,${wins},,,,,`,
  `Number Losing Trades,${ledger.length - wins},,,,,`,
  `Percent Profitable,,${new Decimal(wins).div(ledger.length).times(100).toDecimalPlaces(2).toFixed(2)},,,,`,
  `Initial Capital,10000,,,,,`,
];
writeFileSync(join(out, "classic-performance-summary.csv"), `${summaryClassic.join("\r\n")}\r\n`);

// ---- Variant 2: P&L layout, semicolon-delimited, comma decimal, New York chart ----
const pnlLayout = ["Trade #;Type;Date and time;Signal;Price USDT;Position size (qty);Position size (value);Net P&L USDT;Net P&L %;Favorable excursion USDT;Favorable excursion %;Adverse excursion USDT;Adverse excursion %;Cumulative P&L USDT;Cumulative P&L %"];
for (const r of rows) {
  const d = r.t.dir.toLowerCase();
  const line = (type: string, time: string, sig: string, price: string) =>
    [r.t.n, type, fmtNy(time), sig, comma(price), comma(r.t.qty), comma(r.notional.toDecimalPlaces(2)), comma(r.p.toFixed(2)), comma(r.pPct.toFixed(2)), "0", "0", "0", "0", comma(r.cum.toFixed(2)), comma(r.cumPct.toFixed(2))].join(";");
  pnlLayout.push(line(`Entry ${d}`, r.t.entry, r.t.entrySignal, r.t.entryPrice));
  pnlLayout.push(line(`Exit ${d}`, r.t.exit, r.t.exitSignal, r.t.exitPrice));
}
writeFileSync(join(out, "pnl-list-of-trades.csv"), `${pnlLayout.join("\n")}\n`);

const summaryMetric = [
  "Metric;All USDT;All %;Long USDT;Long %;Short USDT;Short %",
  `Initial capital;10000;;;;;`,
  `Net profit;${comma(netProfit)};${comma(pct(netProfit))};${comma(sum(longRows))};;${comma(sum(shortRows))};`,
  `Gross profit;${comma(grossProfit.toFixed(2))};;;;;`,
  `Gross loss;${comma(grossLoss.toFixed(2))};;;;;`,
  `Commission paid;${comma(commissionPaid.toDecimalPlaces(2).toFixed(2))};;;;;`,
  `Max equity drawdown (intrabar);${comma(intrabarDd.toFixed(2))};${comma(intrabarDd.div(peak).times(100).toDecimalPlaces(2).toFixed(2))};;;;`,
  `Max equity run-up;312,40;3,12;;;;`,
  `Total trades;${ledger.length};;${longRows.length};;${shortRows.length};`,
  `Total open trades;0;;;;;`,
  `Winning trades;${wins};;;;;`,
  `Losing trades;${ledger.length - wins};;;;;`,
  `Percent profitable;;${comma(new Decimal(wins).div(ledger.length).times(100).toDecimalPlaces(2).toFixed(2))};;;;`,
  `Profit factor;${comma(grossProfit.div(grossLoss).toDecimalPlaces(3).toFixed(3))};;;;;`,
];
writeFileSync(join(out, "pnl-performance-summary.csv"), `${summaryMetric.join("\n")}\n`);
process.stdout.write(`net profit ${netProfit}, closed-trade max drawdown ${maxDd.toFixed(2)}, wins ${wins}/${ledger.length}\n`);

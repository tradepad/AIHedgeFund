import type { StrategyDefinition } from "./sdl";
import type { IdeaCard } from "./idea-card";
import type { Handoff } from "./handoff";
import type { SignalEvent } from "./signal-event";
import type { PineManifest } from "./pine";

/** Canonical examples. Used by docs, tests and the development fixture provider. */
export const exampleStrategyDefinition: StrategyDefinition = {
  schemaVersion: "1.0.0",
  strategy: {
    name: "Example Trend Pullback",
    family: "trend_following",
    thesis: "Enter pullbacks in a confirmed higher-timeframe trend.",
    directions: ["long", "short"],
  },
  market: {
    assetClass: "crypto",
    symbols: ["BYBIT:BTCUSDT.P"],
    timeframe: "60",
    timezone: "Etc/UTC",
    session: "0000-2359:1234567",
    chartType: "standard_ohlc",
  },
  signals: {
    trend: {
      type: "ema_relation",
      fastLength: { parameter: "fast_length" },
      slowLength: { parameter: "slow_length" },
    },
    longEntry: "trend_fast_above_slow AND pullback_recovery AND confirmed_bar",
    shortEntry: "trend_fast_below_slow AND pullback_rejection AND confirmed_bar",
  },
  execution: {
    entryOrder: "market_next_bar",
    pyramiding: 0,
    allowReversal: false,
    processOnClose: false,
    calcOnEveryTick: false,
  },
  risk: {
    sizingModel: "percent_of_equity",
    sizePercent: 10,
    leverage: 3,
    stopLoss: { type: "atr_multiple", valueParameter: "stop_atr" },
    takeProfit: { type: "risk_multiple", valueParameter: "target_r" },
    oneStopOneTarget: true,
  },
  costs: { commissionType: "percent", commissionValue: 0.06, slippageTicks: 2 },
  parameters: [
    { key: "fast_length", type: "int", default: 20, min: 10, max: 50, step: 5 },
    { key: "slow_length", type: "int", default: 100, min: 60, max: 200, step: 10 },
    { key: "stop_atr", type: "float", default: 2.0, min: 1.0, max: 4.0, step: 0.25 },
    { key: "target_r", type: "float", default: 2.0, min: 1.0, max: 4.0, step: 0.25 },
  ],
  segments: { warmupBars: 300, selectionMode: "rolling_walk_forward", embargoBars: 10 },
  falsification: [
    "Out-of-sample net profit is non-positive.",
    "Performance exists only in one calendar segment.",
    "Neighbouring parameters collapse.",
    "Realistic costs remove the edge.",
  ],
};

export const exampleIdeaCard: IdeaCard = {
  schemaVersion: "1.0.0",
  title: "Higher-timeframe trend pullback continuation",
  hypothesis: "Pullbacks within a confirmed 4h trend resume in the trend direction more often than they reverse.",
  sourceSummary: "Widely discussed trend-continuation pattern; treated as a hypothesis, not evidence.",
  sources: [],
  marketMechanism: "Trend persistence from slow-moving capital and delayed information diffusion.",
  expectedDirection: "both",
  targetAssets: ["BYBIT:BTCUSDT.P"],
  targetTimeframes: ["60"],
  expectedRegime: "Persistent directional trends with moderate volatility.",
  failureRegime: "Range-bound, mean-reverting chop with frequent false breaks.",
  requiredInputs: ["OHLC", "EMA", "ATR"],
  pineFeasibility: "HIGH",
  expectedTradeFrequency: "DAILY",
  cheapestFalsificationTest: "Run the baseline on 2 years of hourly data with costs; reject if net profit is non-positive.",
  noveltyScore: 0.2,
  evidenceStrength: "ANECDOTAL",
  similarInternalStrategies: [],
  risks: ["Well-known pattern, edge may be arbitraged away", "Sensitive to cost assumptions"],
  recommendation: "RESEARCH",
  summary: "A low-novelty trend-continuation idea worth a cheap falsification test.",
};

export const exampleHandoff: Handoff = {
  schemaVersion: "1.0.0",
  handoffId: "0192f1a0-0000-7000-8000-000000000001",
  campaignId: "0192f1a0-0000-7000-8000-000000000002",
  strategyId: null,
  strategyVersionId: null,
  fromAgent: {
    role: "IDEA_SCOUT",
    agentId: "fixture-provider",
    promptVersion: "0".repeat(64),
  },
  toRole: "STRATEGY_ARCHITECT",
  taskId: "0192f1a0-0000-7000-8000-000000000003",
  status: "COMPLETE",
  summary: "One Idea Card produced and recommended for research.",
  assumptions: [],
  unknowns: ["Cost sensitivity"],
  riskFlags: [],
  artefactIds: ["0192f1a0-0000-7000-8000-000000000004"],
  evidenceIds: [],
  requestedAction: "Create a deterministic strategy definition",
  createdAt: "2026-10-13T00:00:00Z",
};

export const exampleSignalEvent: SignalEvent = {
  schema: "arf.signal.v1",
  deploymentId: "0192f1a0-0000-7000-8000-000000000010",
  strategyVersionId: "0192f1a0-0000-7000-8000-000000000011",
  eventId: "evt-0001-entry-long",
  eventType: "ENTRY_LONG",
  orderId: "L1",
  symbol: "BYBIT:BTCUSDT.P",
  timeframe: "60",
  barTime: "2026-08-04T17:00:00Z",
  sentAt: "2026-08-04T18:00:01Z",
  price: 100000.0,
  quantityModel: "percent_of_equity",
  stopPrice: 98000.0,
  targetPrice: 104000.0,
};

export const examplePineManifest: PineManifest = {
  schemaVersion: "1.0.0",
  pineVersion: 6,
  strategyId: "0192f1a0-0000-7000-8000-000000000020",
  strategyVersionId: "0192f1a0-0000-7000-8000-000000000021",
  campaignId: "0192f1a0-0000-7000-8000-000000000022",
  parentVersionId: null,
  sdlHash: "a".repeat(64),
  title: "ARF Example Trend Pullback",
  symbol: "BYBIT:BTCUSDT.P",
  timeframe: "60",
  properties: {
    initialCapital: 10000,
    currency: "USDT",
    defaultQtyType: "strategy.percent_of_equity",
    defaultQtyValue: 10,
    commissionType: "strategy.commission.percent",
    commissionValue: 0.06,
    slippageTicks: 2,
    pyramiding: 0,
    marginLongPct: 33,
    marginShortPct: 33,
    processOrdersOnClose: false,
    calcOnEveryTick: false,
    calcOnOrderFills: false,
  },
  inputs: [
    { key: "fast_length", type: "int", default: 20, min: 10, max: 50, step: 5 },
    { key: "slow_length", type: "int", default: 100, min: 60, max: 200, step: 10 },
    { key: "stop_atr", type: "float", default: 2, min: 1, max: 4, step: 0.25 },
    { key: "target_r", type: "float", default: 2, min: 1, max: 4, step: 0.25 },
  ],
  dateWindow: { startInputKey: "start_date", endInputKey: "end_date" },
  alertSchema: "arf.signal.v1",
};

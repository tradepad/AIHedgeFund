/**
 * Runner capability matrix. TradingView is the acceptance environment; no
 * local Pine runner exists in this release, so local backtests are not
 * offered and every result in the slice comes from TradingView exports.
 */
export interface RunnerCapabilities {
  runner: "TRADINGVIEW" | "LOCAL_RUNNER";
  available: boolean;
  compilesPine: boolean;
  executesStrategies: boolean;
  supportsBarMagnifier: boolean;
  supportsRequestSecurity: boolean;
  supportsLowerTimeframe: boolean;
  automation: "HUMAN_ASSISTED" | "NONE";
  notes: string;
}

export const RUNNER_CAPABILITIES: readonly RunnerCapabilities[] = [
  {
    runner: "TRADINGVIEW",
    available: true,
    compilesPine: true,
    executesStrategies: true,
    supportsBarMagnifier: true,
    supportsRequestSecurity: true,
    supportsLowerTimeframe: true,
    automation: "HUMAN_ASSISTED",
    notes: "Operator loads the exact source, runs the Strategy Tester and uploads CSV exports. No browser automation.",
  },
  {
    runner: "LOCAL_RUNNER",
    available: false,
    compilesPine: false,
    executesStrategies: false,
    supportsBarMagnifier: false,
    supportsRequestSecurity: false,
    supportsLowerTimeframe: false,
    automation: "NONE",
    notes: "Not implemented in the first vertical slice.",
  },
];

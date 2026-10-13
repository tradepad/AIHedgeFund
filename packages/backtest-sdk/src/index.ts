import type { BacktestRunId, ParserWarning, PineManifest, Trade, EquityPoint } from "@arf/contracts";
import { RUNNER_CAPABILITIES, type RunnerCapabilities } from "@arf/pine";

export type { RunnerCapabilities } from "@arf/pine";

export interface CompileInput {
  source: string;
  manifest: PineManifest;
}

export type CompileResult =
  | { ok: true; warnings: ParserWarning[] }
  | { ok: false; errorCode: string; detail: string; line: number | null };

export interface BacktestInput {
  runId: BacktestRunId;
  source: string;
  manifest: PineManifest;
  datasetVersionId: string;
  parameters: Record<string, number | boolean>;
  segment: { fromUtc: string; toUtc: string };
}

/** Every runner result carries full identity so it can be reproduced and compared (CLAUDE.md §13). */
export interface BacktestResult {
  runner: { name: string; version: string };
  codeHash: string;
  manifestHash: string;
  datasetHash: string;
  environmentHash: string;
  parameters: Record<string, number | boolean>;
  executionSettings: Record<string, unknown>;
  trades: Trade[];
  equity: EquityPoint[];
  /** Runner-specific warnings are preserved verbatim, never normalised away. */
  warnings: ParserWarning[];
  timing: { startedAt: string; completedAt: string };
  error: { code: string; detail: string } | null;
}

export interface BacktestRunner {
  capabilities(): RunnerCapabilities;
  compile(input: CompileInput): Promise<CompileResult>;
  run(input: BacktestInput): Promise<BacktestResult>;
  cancel(runId: BacktestRunId): Promise<void>;
}

export class RunnerUnavailableError extends Error {
  constructor(runner: string) {
    super(`${runner} is not available in this release`);
  }
}

/**
 * Placeholder for the Pine-compatible local runner. It reports itself as
 * unavailable and refuses to run, so nothing can mistake it for evidence.
 */
export class UnavailableLocalRunner implements BacktestRunner {
  capabilities(): RunnerCapabilities {
    const caps = RUNNER_CAPABILITIES.find((c) => c.runner === "LOCAL_RUNNER");
    if (!caps) throw new Error("capability matrix is missing LOCAL_RUNNER");
    return caps;
  }
  compile(): Promise<CompileResult> {
    return Promise.reject(new RunnerUnavailableError("LOCAL_RUNNER"));
  }
  run(): Promise<BacktestResult> {
    return Promise.reject(new RunnerUnavailableError("LOCAL_RUNNER"));
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
}

import type { PineLintFinding, PineLintResult, PineManifest } from "@arf/contracts";
import { normalisePineSource } from "./hashing";

export const PINE_LINTER_VERSION = "1.0.0";

type Finding = PineLintFinding;

interface Call {
  args: string;
  line: number;
  start: number;
}

/** Remove `//` comments outside string literals. */
function stripComments(line: string): string {
  let inString: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === inString) inString = null;
    } else if (c === '"' || c === "'") {
      inString = c;
    } else if (c === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** Find calls to `name(` (exact identifier, not a method suffix) and return their argument text. */
function findCalls(code: string, name: string): Call[] {
  const escaped = name.replace(/\./g, "\\.");
  const re = new RegExp(`(^|[^\\w.])${escaped}\\s*\\(`, "g");
  const calls: Call[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let inString: string | null = null;
    let end = -1;
    for (let i = open; i < code.length; i++) {
      const c = code[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'") inString = c;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > open) calls.push({ args: code.slice(open + 1, end), line: lineOf(code, m.index), start: m.index });
  }
  return calls;
}

/** Split arguments at top-level commas into positional and named arguments. */
function splitArgs(args: string): { positional: string[]; named: Map<string, string> } {
  const parts: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let current = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i] ?? "";
    if (inString) {
      current += c;
      if (c === "\\") {
        current += args[i + 1] ?? "";
        i++;
      } else if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") inString = c;
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const part of parts) {
    const m = /^([a-z_][a-z0-9_]*)\s*=(?!=)\s*([\s\S]+)$/i.exec(part);
    if (m?.[1] && m[2] !== undefined) named.set(m[1], m[2].trim());
    else positional.push(part);
  }
  return { positional, named };
}

function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function bool(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * Static checks for ARF Pine standards (spec §11.11, CLAUDE.md §12.2–12.3).
 * This is a conservative pattern checker, not a Pine compiler: TradingView
 * remains the compile and acceptance environment. Hard errors block the
 * transition to TradingView verification.
 */
export function lintPine(rawSource: string, manifest: PineManifest): PineLintResult {
  const source = normalisePineSource(rawSource);
  const lines = source.split("\n");
  const code = lines.map(stripComments).join("\n");
  const findings: Finding[] = [];
  const error = (rule: string, message: string, line: number | null = null) =>
    findings.push({ rule, severity: "ERROR", message, line });
  const warn = (rule: string, message: string, line: number | null = null) =>
    findings.push({ rule, severity: "WARNING", message, line });

  // --- Version ------------------------------------------------------------
  const versionLine = lines.findIndex((l) => /^\s*\/\/@version=\d+/.test(l));
  if (versionLine === -1) error("PINE_VERSION", "missing //@version=6 declaration");
  else if (!/^\s*\/\/@version=6\s*$/.test(lines[versionLine] ?? "")) {
    error("PINE_VERSION", "Pine Script v6 is required", versionLine + 1);
  }

  // --- Identity header ------------------------------------------------------
  const header = (label: string, expected: string) => {
    const re = new RegExp(`^\\s*//\\s*${label}:\\s*(\\S+)`, "m");
    const m = re.exec(source);
    if (!m) error("MISSING_SDL_IDENTITY", `metadata header is missing "${label}"`);
    else if (m[1] !== expected) error("MISSING_SDL_IDENTITY", `"${label}" is ${m[1]} but manifest declares ${expected}`, lineOf(source, m.index));
  };
  header("ARF-OS Strategy ID", manifest.strategyId);
  header("Strategy Version ID", manifest.strategyVersionId);
  header("SDL Hash", manifest.sdlHash);

  // --- strategy() declaration ----------------------------------------------
  if (findCalls(code, "indicator").length > 0) {
    error("MISSING_STRATEGY_DECLARATION", "testable scripts must use strategy(), not indicator()");
  }
  const decls = findCalls(code, "strategy");
  if (decls.length !== 1) {
    error("MISSING_STRATEGY_DECLARATION", decls.length === 0 ? "no strategy() declaration found" : "multiple strategy() declarations");
  }
  const decl = decls[0];
  if (decl) {
    const { named } = splitArgs(decl.args);
    const p = manifest.properties;
    const mismatch = (key: string, actual: string, expected: string) =>
      error("SOURCE_MANIFEST_MISMATCH", `strategy(${key}) is ${actual} but manifest declares ${expected}`, decl.line);
    const requireNum = (key: string, expected: number, missingRule: string) => {
      const raw = named.get(key);
      if (raw === undefined) return error(missingRule, `strategy() must declare ${key} explicitly`, decl.line);
      const v = num(raw);
      if (v === null || v !== expected) mismatch(key, raw, String(expected));
    };
    const requireBool = (key: string, expected: boolean, missingRule: string) => {
      const raw = named.get(key);
      if (raw === undefined) return error(missingRule, `strategy() must declare ${key} explicitly`, decl.line);
      if (bool(raw) !== expected) mismatch(key, raw, String(expected));
    };
    const requireEnum = (key: string, expected: string, missingRule: string) => {
      const raw = named.get(key);
      if (raw === undefined) return error(missingRule, `strategy() must declare ${key} explicitly`, decl.line);
      if (raw !== expected) mismatch(key, raw, expected);
    };
    requireNum("initial_capital", p.initialCapital, "MISSING_STRATEGY_PROPERTY");
    requireEnum("currency", `currency.${p.currency}`, "MISSING_STRATEGY_PROPERTY");
    requireEnum("default_qty_type", p.defaultQtyType, "MISSING_STRATEGY_PROPERTY");
    requireNum("default_qty_value", p.defaultQtyValue, "MISSING_STRATEGY_PROPERTY");
    requireEnum("commission_type", p.commissionType, "MISSING_COST_MODEL");
    requireNum("commission_value", p.commissionValue, "MISSING_COST_MODEL");
    requireNum("slippage", p.slippageTicks, "MISSING_COST_MODEL");
    requireNum("pyramiding", 0, "UNDECLARED_PYRAMIDING");
    requireNum("margin_long", p.marginLongPct, "MISSING_MARGIN");
    requireNum("margin_short", p.marginShortPct, "MISSING_MARGIN");
    requireBool("process_orders_on_close", p.processOrdersOnClose, "MISSING_STRATEGY_PROPERTY");
    requireBool("calc_on_every_tick", p.calcOnEveryTick, "UNDECLARED_CALC_ON_EVERY_TICK");
    requireBool("calc_on_order_fills", p.calcOnOrderFills, "MISSING_STRATEGY_PROPERTY");
    if (p.calcOnEveryTick) warn("CALC_ON_EVERY_TICK", "calc_on_every_tick=true: realtime and historical behaviour can differ", decl.line);
    if (p.processOrdersOnClose) warn("PROCESS_ON_CLOSE", "process_orders_on_close=true deviates from next-bar execution", decl.line);
    if (Math.min(p.marginLongPct, p.marginShortPct) < 10) warn("HIGH_LEVERAGE", "margin below 10% implies leverage above 10x", decl.line);
  }

  // --- Anti-repainting / leakage ------------------------------------------
  const future = /\[\s*-\s*\d+\s*\]/g;
  for (let m = future.exec(code); m !== null; m = future.exec(code)) {
    error("FUTURE_REFERENCE", "negative history reference reads future bars", lineOf(code, m.index));
  }
  const negOffset = /\boffset\s*=\s*-\s*\d/g;
  for (let m = negOffset.exec(code); m !== null; m = negOffset.exec(code)) {
    error("NEGATIVE_OFFSET", "negative plot offset implies earlier signals than were available", lineOf(code, m.index));
  }
  const securityCalls = findCalls(code, "request.security");
  for (const call of securityCalls) {
    const lookaheadOn = /lookahead\s*=\s*barmerge\.lookahead_on/.test(call.args);
    const confirmedOffset = /\[\s*1\s*\]/.test(call.args);
    if (lookaheadOn && !confirmedOffset) {
      error("UNSAFE_LOOKAHEAD", "barmerge.lookahead_on requires a [1]-offset confirmed series", call.line);
    } else if (!lookaheadOn) {
      error("UNCONFIRMED_MTF", "higher-timeframe values must use the confirmed pattern expr[1] with lookahead_on", call.line);
    }
  }
  if (securityCalls.length > 5) warn("LARGE_REQUEST_COUNT", `${securityCalls.length} request.security calls`);
  for (const call of findCalls(code, "request.security_lower_tf")) {
    warn("LOWER_TIMEFRAME_AMBIGUITY", "lower-timeframe request needs a documented aggregation rule", call.line);
  }
  const nonStandard = /\bticker\.(heikinashi|renko|kagi|pointfigure|linebreak)\b/g;
  for (let m = nonStandard.exec(code); m !== null; m = nonStandard.exec(code)) {
    warn("NON_STANDARD_CHART", `non-standard chart type ${m[1] ?? ""}`, lineOf(code, m.index));
  }
  if (!/\bbarstate\.isconfirmed\b/.test(code)) {
    warn("UNCONFIRMED_SIGNAL_LOGIC", "no barstate.isconfirmed guard found; confirm signals use closed bars");
  }

  // --- Inputs ---------------------------------------------------------------
  const declaredInputs = new Map(manifest.inputs.map((i) => [i.key, i]));
  const seenInputs = new Set<string>();
  const inputRe = /^\s*(?:var\s+|(?:int|float|bool)\s+)?([a-z_][a-z0-9_]*)\s*=\s*input\.(int|float|bool|time)\s*\(/gim;
  for (let m = inputRe.exec(code); m !== null; m = inputRe.exec(code)) {
    const key = m[1] ?? "";
    const kind = m[2] ?? "";
    const line = lineOf(code, m.index);
    const call = findCalls(code.slice(m.index), `input.${kind}`)[0];
    if (!call) continue;
    const { positional, named } = splitArgs(call.args);
    if (kind === "time") {
      if (key !== manifest.dateWindow.startInputKey && key !== manifest.dateWindow.endInputKey) {
        warn("UNDECLARED_TIME_INPUT", `time input ${key} is not the declared date window`, line);
      }
      seenInputs.add(key);
      continue;
    }
    seenInputs.add(key);
    const decl_ = declaredInputs.get(key);
    if (!decl_) {
      error("UNDECLARED_INPUT", `input ${key} is not declared in the manifest`, line);
      continue;
    }
    if (decl_.type !== kind) error("SOURCE_MANIFEST_MISMATCH", `input ${key} is ${kind} but manifest declares ${decl_.type}`, line);
    const def = named.get("defval") ?? positional[0];
    const defVal = kind === "bool" ? bool(def) : num(def);
    if (defVal !== decl_.default) error("SOURCE_MANIFEST_MISMATCH", `input ${key} default ${def ?? "?"} differs from manifest ${String(decl_.default)}`, line);
    if (kind !== "bool") {
      const min = num(named.get("minval"));
      const max = num(named.get("maxval"));
      if (min === null || max === null) {
        error("UNBOUNDED_INPUT", `optimisable input ${key} must declare minval and maxval`, line);
      } else if (min !== decl_.min || max !== decl_.max) {
        error("SOURCE_MANIFEST_MISMATCH", `input ${key} bounds [${min}, ${max}] differ from manifest [${String(decl_.min)}, ${String(decl_.max)}]`, line);
      }
      const step = num(named.get("step"));
      if (decl_.step !== undefined && step !== decl_.step) {
        error("SOURCE_MANIFEST_MISMATCH", `input ${key} step differs from manifest`, line);
      }
    }
  }
  for (const key of declaredInputs.keys()) {
    if (!seenInputs.has(key)) error("SOURCE_MANIFEST_MISMATCH", `manifest input ${key} is not defined in source`);
  }
  for (const key of [manifest.dateWindow.startInputKey, manifest.dateWindow.endInputKey]) {
    if (!seenInputs.has(key)) error("MISSING_DATE_WINDOW", `date window input ${key} (input.time) is missing`);
  }

  // --- Orders ---------------------------------------------------------------
  for (const call of findCalls(code, "strategy.entry")) {
    const { positional, named } = splitArgs(call.args);
    if (!/^"[^"]+"$/.test(positional[0] ?? named.get("id") ?? "")) {
      error("UNSTABLE_ORDER_ID", "strategy.entry ids must be string literals", call.line);
    }
    if (named.has("limit")) warn("LIMIT_FILL_ASSUMPTION", "limit entries assume fills TradingView may not reproduce", call.line);
  }
  const exits = findCalls(code, "strategy.exit");
  for (const call of exits) {
    const { named } = splitArgs(call.args);
    if ((named.has("stop") || named.has("loss")) && (named.has("limit") || named.has("profit"))) {
      warn("SAME_BAR_STOP_TARGET", "stop and target on one exit: same-bar ordering follows TradingView's intrabar assumptions", call.line);
    }
  }
  if (exits.length === 0) error("MISSING_STOP_TARGET", "no strategy.exit with stop and target found");

  // --- Alerts ---------------------------------------------------------------
  const requiredAlertFields = ["arf.signal.v1", "deploymentId", "strategyVersionId", "eventId", "eventType", "barTime"];
  const missingAlert = requiredAlertFields.filter((f) => !source.includes(f));
  if (missingAlert.length > 0) {
    error("MISSING_ALERT_FIELDS", `alert payload is missing: ${missingAlert.join(", ")}`);
  }

  const hasError = findings.some((f) => f.severity === "ERROR");
  const hasWarning = findings.some((f) => f.severity === "WARNING");
  return {
    linterVersion: PINE_LINTER_VERSION,
    status: hasError ? "FAIL" : hasWarning ? "WARN" : "PASS",
    findings,
  };
}

/**
 * Import external research (trader-dev runs, offline scripts, library results)
 * into the strategy registry as external evidence.
 *
 *   pnpm import:external <bundle.json> [--org arf-dev] [--as dev|researcher] [--dry-run]
 *
 * The bundle is validated against ExternalImportBundleSchema. The whole import
 * runs in one transaction, so it either lands completely or not at all, and a
 * re-run of the same bundle creates nothing new.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ExternalImportBundleSchema, err } from "@arf/contracts";
import { hasPermission, resolvePrincipal } from "@arf/auth";
import { createDb, refreshStrategyLibraryRow } from "@arf/db";
import { METRICS_CALCULATION_VERSION } from "@arf/metrics";
import { createLogger, newTraceId } from "@arf/observability";
import { createObjectStore } from "@arf/storage";
import { WorkflowEngine } from "@arf/workflow";
import { loadConfig } from "../config";
import type { AppContext, RequestScope } from "../context";
import { ProblemError } from "../http/problem";
import { importExternalBundle } from "../services/external-evidence";

/** Thrown to roll back the transaction after a dry run has reported its summary. */
class DryRunRollback extends Error {}

function fail(message: string): never {
  process.stderr.write(`import failed: ${message}\n`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    org: { type: "string", default: "arf-dev" },
    as: { type: "string", default: "dev|researcher" },
    "dry-run": { type: "boolean", default: false },
  },
});
const file = positionals[0];
if (!file)
  fail("usage: pnpm import:external <bundle.json> [--org slug] [--as subject] [--dry-run]");

// pnpm runs workspace scripts from the package directory; resolve relative
// paths against the directory the command was typed in.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  fail(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
}
const parsed = ExternalImportBundleSchema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues
    .slice(0, 20)
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  fail(`${path} is not a valid import bundle:\n${issues}`);
}
const bundle = parsed.data;

const config = loadConfig();
const logger = createLogger("import-external", { level: config.LOG_LEVEL });
const handle = createDb(config.DATABASE_URL, { max: 2 });
const ctx: AppContext = {
  config,
  db: handle.db,
  store: createObjectStore(config),
  auth: {
    mode: config.AUTH_MODE,
    verify: () =>
      Promise.resolve(err({ code: "UNAUTHENTICATED", detail: "not available from the CLI" })),
  },
  workflow: new WorkflowEngine(),
  logger,
  bus: null,
};

try {
  const principal = await resolvePrincipal(
    handle.db,
    { subject: values.as, externalOrgId: null },
    values.org,
  );
  if (!principal.ok) fail(`${principal.error.code}: ${principal.error.detail}`);
  if (!hasPermission(principal.value.roles, "strategy:write"))
    fail(`${values.as} lacks the strategy:write permission in ${values.org}`);
  const traceId = newTraceId();
  const scope: RequestScope = { principal: principal.value, traceId, correlationId: traceId };

  let summary;
  try {
    summary = await handle.db.transaction(async (tx) => {
      const s = await importExternalBundle(ctx, tx, scope, bundle);
      if (values["dry-run"]) {
        process.stdout.write(
          `${JSON.stringify({ dryRun: true, ...s, versionIds: undefined }, null, 2)}\n`,
        );
        throw new DryRunRollback("dry run");
      }
      return s;
    });
  } catch (e) {
    if (e instanceof DryRunRollback) {
      process.stdout.write("dry run: nothing was written to the database\n");
      process.exit(0);
    }
    if (e instanceof ProblemError) fail(`${e.code}: ${e.detail}`);
    throw e;
  }

  // The library read model is derived; refresh it now so the import shows up
  // without waiting for the analytics worker.
  for (const id of summary.versionIds)
    await refreshStrategyLibraryRow(handle.db, id, METRICS_CALCULATION_VERSION);

  const line = (label: string, c: { created: number; reused: number }) =>
    `  ${label.padEnd(11)} ${String(c.created).padStart(4)} created  ${String(c.reused).padStart(4)} already present\n`;
  process.stdout.write(
    `imported "${bundle.title}" into ${values.org} as ${values.as}\n` +
      line("campaigns", summary.campaigns) +
      line("strategies", summary.strategies) +
      line("versions", summary.versions) +
      line("results", summary.results) +
      `  bundle sha256 ${summary.bundleSha256}\n`,
  );
} finally {
  await handle.close();
}

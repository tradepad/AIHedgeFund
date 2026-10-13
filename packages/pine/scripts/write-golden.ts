/** Regenerates pine/boilerplate and pine/fixtures/golden from the approved template. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleStrategyDefinition, examplePineManifest } from "@arf/contracts";
import { TREND_PULLBACK_TEMPLATE, manifestFromDefinition, renderTrendPullbackTemplate } from "../src";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "pine");
const manifest = manifestFromDefinition(exampleStrategyDefinition, {
  strategyId: examplePineManifest.strategyId,
  strategyVersionId: examplePineManifest.strategyVersionId,
  campaignId: examplePineManifest.campaignId,
  parentVersionId: null,
  sdlHash: examplePineManifest.sdlHash,
  symbol: "BYBIT:BTCUSDT.P",
  timeframe: "60",
  initialCapital: 10000,
  currency: "USDT",
});
const rendered = renderTrendPullbackTemplate(exampleStrategyDefinition, manifest);
if (!rendered.ok) throw new Error(rendered.error.detail);
mkdirSync(join(root, "boilerplate"), { recursive: true });
mkdirSync(join(root, "fixtures", "golden"), { recursive: true });
writeFileSync(join(root, "boilerplate", "arf_trend_pullback.template.pine"), TREND_PULLBACK_TEMPLATE);
writeFileSync(join(root, "fixtures", "golden", "trend_pullback.pine"), rendered.value);
writeFileSync(join(root, "fixtures", "golden", "trend_pullback.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

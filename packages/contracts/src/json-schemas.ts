import { z } from "zod";
import { StrategyDefinitionSchema } from "./sdl";
import { HandoffSchema } from "./handoff";
import { SignalEventSchema } from "./signal-event";
import { IdeaCardSchema } from "./idea-card";
import { PineManifestSchema } from "./pine";
import { ExternalImportBundleSchema } from "./external-results";

/**
 * Zod is canonical. The JSON Schema files in `/schemas` are generated from
 * these definitions (`pnpm schemas:generate`) and a test fails if they drift.
 */
export const publishedJsonSchemas = {
  "strategy-definition.schema.json": {
    id: "https://arf-os.dev/schemas/strategy-definition/1.0.0",
    schema: StrategyDefinitionSchema,
  },
  "agent-handoff.schema.json": {
    id: "https://arf-os.dev/schemas/agent-handoff/1.0.0",
    schema: HandoffSchema,
  },
  "signal-event.schema.json": {
    id: "https://arf-os.dev/schemas/signal-event/1.0.0",
    schema: SignalEventSchema,
  },
  "idea-card.schema.json": {
    id: "https://arf-os.dev/schemas/idea-card/1.0.0",
    schema: IdeaCardSchema,
  },
  "pine-manifest.schema.json": {
    id: "https://arf-os.dev/schemas/pine-manifest/1.0.0",
    schema: PineManifestSchema,
  },
  "external-import-bundle.schema.json": {
    id: "https://arf-os.dev/schemas/external-import-bundle/1.0.0",
    schema: ExternalImportBundleSchema,
  },
} as const;

export function renderJsonSchema(name: keyof typeof publishedJsonSchemas): string {
  const entry = publishedJsonSchemas[name];
  const json = z.toJSONSchema(entry.schema, { unrepresentable: "any" });
  return `${JSON.stringify({ ...json, $id: entry.id }, null, 2)}\n`;
}

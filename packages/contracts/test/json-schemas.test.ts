import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publishedJsonSchemas, renderJsonSchema } from "../src";

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schemas");

describe("published JSON schemas", () => {
  it.each(Object.keys(publishedJsonSchemas) as (keyof typeof publishedJsonSchemas)[])(
    "%s matches the Zod source (run pnpm schemas:generate if this fails)",
    (name) => {
      expect(readFileSync(join(schemasDir, name), "utf8")).toBe(renderJsonSchema(name));
    },
  );
});

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedJsonSchemas, renderJsonSchema } from "../src/json-schemas";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schemas");
const check = process.argv.includes("--check");
mkdirSync(root, { recursive: true });
let drift = false;
for (const name of Object.keys(publishedJsonSchemas) as (keyof typeof publishedJsonSchemas)[]) {
  const path = join(root, name);
  const rendered = renderJsonSchema(name);
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== rendered) {
      process.stderr.write(`schema drift: ${name}\n`);
      drift = true;
    }
  } else {
    writeFileSync(path, rendered);
    process.stdout.write(`wrote schemas/${name}\n`);
  }
}
if (drift) process.exit(1);

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../client";
import { DEVELOPMENT_ORGS, seedOrganisations, seedPrompts } from "../seed";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  process.stderr.write("refusing to seed development identities in production\n");
  process.exit(1);
}
const promptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "agent-runtime",
  "prompts",
);
const handle = createDb(url, { max: 1 });
try {
  await seedOrganisations(handle.db, DEVELOPMENT_ORGS);
  await seedPrompts(handle.db, [
    { role: "IDEA_SCOUT", semver: "1.0.0", path: join(promptsDir, "idea-scout", "1.0.0.md") },
  ]);
  process.stdout.write("development seed applied\n");
} finally {
  await handle.close();
}

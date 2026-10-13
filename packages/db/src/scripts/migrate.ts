import { createDb } from "../client";
import { runMigrations } from "../migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}
const handle = createDb(url, { max: 1 });
try {
  await runMigrations(handle.db);
  process.stdout.write("migrations applied\n");
} finally {
  await handle.close();
}

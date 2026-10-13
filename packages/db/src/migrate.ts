import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client";

export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}

import { and, desc, eq } from "drizzle-orm";
import type { AgentRole } from "@arf/contracts";
import { promptVersions, type DbOrTx } from "@arf/db";

/**
 * Load the newest APPROVED prompt for a role. Draft and challenger prompts
 * are never returned, so they cannot run in production.
 */
export async function loadApprovedPrompt(
  db: DbOrTx,
  role: AgentRole,
): Promise<typeof promptVersions.$inferSelect | null> {
  const rows = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.role, role), eq(promptVersions.status, "APPROVED")))
    .orderBy(desc(promptVersions.approvedAt), desc(promptVersions.id))
    .limit(1);
  return rows[0] ?? null;
}

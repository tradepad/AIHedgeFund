import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { uuidv7, type AgentRole, type MemberRole } from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";
import type { Database } from "./client";
import { memberships, organisations, promptVersions, users } from "./schema";

export interface SeedUser {
  subject: string;
  email: string;
  displayName: string;
  roles: MemberRole[];
}

export interface SeedOrg {
  slug: string;
  name: string;
  users: SeedUser[];
}

/**
 * Development identities. These exist so the dev auth provider and end-to-end
 * tests have deterministic actors; they are not created in production.
 */
export const DEVELOPMENT_ORGS: SeedOrg[] = [
  {
    slug: "arf-dev",
    name: "ARF Development",
    users: [
      { subject: "dev|researcher", email: "researcher@arf.local", displayName: "Riley Researcher", roles: ["RESEARCHER", "DEVELOPER"] },
      { subject: "dev|committee", email: "committee@arf.local", displayName: "Casey Committee", roles: ["COMMITTEE_MEMBER", "VALIDATOR"] },
      { subject: "dev|operator", email: "operator@arf.local", displayName: "Oakley Operator", roles: ["OPERATOR"] },
      { subject: "dev|viewer", email: "viewer@arf.local", displayName: "Vic Viewer", roles: ["VIEWER"] },
      { subject: "dev|admin", email: "admin@arf.local", displayName: "Ari Admin", roles: ["ADMIN"] },
    ],
  },
  {
    slug: "arf-other",
    name: "Other Organisation",
    users: [{ subject: "dev|outsider", email: "outsider@other.local", displayName: "Out Sider", roles: ["ADMIN"] }],
  },
];

export interface SeedPrompt {
  role: AgentRole;
  semver: string;
  path: string;
}

export async function seedOrganisations(db: Database, orgs: SeedOrg[]): Promise<Map<string, string>> {
  const orgIds = new Map<string, string>();
  for (const org of orgs) {
    await db.insert(organisations).values({ id: uuidv7(), slug: org.slug, name: org.name }).onConflictDoNothing();
    const [orgRow] = await db.select().from(organisations).where(eq(organisations.slug, org.slug));
    if (!orgRow) throw new Error(`seed: organisation ${org.slug} missing after insert`);
    orgIds.set(org.slug, orgRow.id);
    for (const u of org.users) {
      await db
        .insert(users)
        .values({ id: uuidv7(), externalSubject: u.subject, email: u.email, displayName: u.displayName })
        .onConflictDoNothing();
      const [userRow] = await db.select().from(users).where(eq(users.externalSubject, u.subject));
      if (!userRow) throw new Error(`seed: user ${u.subject} missing after insert`);
      const existing = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organisationId, orgRow.id), eq(memberships.userId, userRow.id)));
      if (existing.length === 0) {
        await db.insert(memberships).values({ id: uuidv7(), organisationId: orgRow.id, userId: userRow.id, roles: u.roles });
      }
    }
  }
  return orgIds;
}

/**
 * Register a prompt version as APPROVED. Seeded prompts are approved by the
 * repository itself (`seed:repository`): their content is reviewed through
 * pull requests. Production promotion of challengers requires a human.
 */
export async function seedPrompts(db: Database, prompts: SeedPrompt[]): Promise<void> {
  for (const p of prompts) {
    const content = readFileSync(p.path, "utf8");
    await db
      .insert(promptVersions)
      .values({
        id: uuidv7(),
        role: p.role,
        semver: p.semver,
        content,
        contentHash: sha256Hex(content),
        status: "APPROVED",
        approvedBy: "seed:repository",
        approvedAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

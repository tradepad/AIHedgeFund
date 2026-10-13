import { and, eq, or } from "drizzle-orm";
import { err, ok, type MemberRole, type OrganisationId, type Result, type UserId } from "@arf/contracts";
import { memberships, organisations, users, type DbOrTx } from "@arf/db";
import type { VerifiedIdentity } from "./verifier";

export interface Principal {
  userId: UserId;
  subject: string;
  displayName: string;
  organisationId: OrganisationId;
  organisationSlug: string;
  roles: MemberRole[];
}

export type PrincipalFailure = {
  code: "USER_NOT_PROVISIONED" | "ORGANISATION_REQUIRED" | "NOT_A_MEMBER" | "ORGANISATION_MISMATCH";
  detail: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an authenticated identity to an organisation-scoped principal.
 * The requested organisation (header) is never trusted on its own: a
 * membership row must exist, and if the identity provider asserts an
 * organisation the two must agree.
 */
export async function resolvePrincipal(
  db: DbOrTx,
  identity: VerifiedIdentity,
  requestedOrganisation: string | undefined,
): Promise<Result<Principal, PrincipalFailure>> {
  const [user] = await db.select().from(users).where(eq(users.externalSubject, identity.subject)).limit(1);
  if (!user) return err({ code: "USER_NOT_PROVISIONED", detail: "no user is provisioned for this identity" });

  let orgFilter;
  if (identity.externalOrgId) {
    orgFilter = eq(organisations.externalAuthOrgId, identity.externalOrgId);
  } else if (requestedOrganisation) {
    orgFilter = UUID_RE.test(requestedOrganisation)
      ? or(eq(organisations.id, requestedOrganisation), eq(organisations.slug, requestedOrganisation))
      : eq(organisations.slug, requestedOrganisation);
  } else {
    return err({ code: "ORGANISATION_REQUIRED", detail: "select an organisation with the X-ARF-Org header" });
  }

  const [row] = await db
    .select({ org: organisations, membership: memberships })
    .from(memberships)
    .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
    .where(and(eq(memberships.userId, user.id), orgFilter))
    .limit(1);
  if (!row) return err({ code: "NOT_A_MEMBER", detail: "you are not a member of this organisation" });
  if (
    identity.externalOrgId &&
    requestedOrganisation &&
    requestedOrganisation !== row.org.slug &&
    requestedOrganisation !== row.org.id
  ) {
    return err({ code: "ORGANISATION_MISMATCH", detail: "requested organisation differs from the active session organisation" });
  }
  return ok({
    userId: user.id as UserId,
    subject: user.externalSubject,
    displayName: user.displayName,
    organisationId: row.org.id as OrganisationId,
    organisationSlug: row.org.slug,
    roles: row.membership.roles,
  });
}

import type { MemberRole } from "@arf/contracts";

export const PERMISSIONS = [
  "read",
  "audit:read",
  "protected:read",
  "campaign:write",
  "idea:write",
  "strategy:write",
  "pine:write",
  "verification:write",
  "report:upload",
  "workflow:transition",
  "decision:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  VIEWER: ["read"],
  RESEARCHER: ["read", "campaign:write", "idea:write", "strategy:write", "verification:write", "report:upload", "workflow:transition"],
  DEVELOPER: ["read", "strategy:write", "pine:write", "workflow:transition"],
  VALIDATOR: ["read", "audit:read", "protected:read", "workflow:transition"],
  OPERATOR: ["read", "verification:write", "report:upload"],
  COMMITTEE_MEMBER: ["read", "audit:read", "decision:write"],
  ADMIN: PERMISSIONS,
  SERVICE_ACCOUNT: ["read", "workflow:transition"],
};

export function permissionsFor(roles: readonly MemberRole[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) out.add(p);
  return out;
}

export function hasPermission(roles: readonly MemberRole[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

/**
 * Separation of duties: the actor must not be any of the authors of the work
 * being judged (CLAUDE.md §3.4, spec §17.2).
 */
export function isIndependentOf(actorUserId: string, authorUserIds: readonly (string | null | undefined)[]): boolean {
  return !authorUserIds.some((id) => id === actorUserId);
}

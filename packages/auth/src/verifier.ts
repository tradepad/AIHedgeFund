import { verifyToken } from "@clerk/backend";
import { err, ok, type Result } from "@arf/contracts";

export interface VerifiedIdentity {
  subject: string;
  /** Organisation asserted by the identity provider, if any. Still checked against memberships. */
  externalOrgId: string | null;
}

export type AuthFailure = { code: "UNAUTHENTICATED" | "INVALID_TOKEN"; detail: string };

export interface AuthVerifier {
  readonly mode: "dev" | "clerk";
  verify(authorizationHeader: string | undefined): Promise<Result<VerifiedIdentity, AuthFailure>>;
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Development-only verifier. Accepts `Bearer dev:<subject>` where subject is a
 * seeded `dev|...` identity. Refuses to construct in production.
 */
export class DevAuthVerifier implements AuthVerifier {
  readonly mode = "dev" as const;

  constructor(nodeEnv: string | undefined) {
    if (nodeEnv === "production") {
      throw new Error("DevAuthVerifier cannot be used when NODE_ENV=production");
    }
  }

  verify(header: string | undefined): Promise<Result<VerifiedIdentity, AuthFailure>> {
    const token = bearer(header);
    if (!token) return Promise.resolve(err({ code: "UNAUTHENTICATED", detail: "missing bearer token" }));
    const match = /^dev:(dev\|[a-z0-9_-]{1,64})$/.exec(token);
    if (!match?.[1]) return Promise.resolve(err({ code: "INVALID_TOKEN", detail: "malformed development token" }));
    return Promise.resolve(ok({ subject: match[1], externalOrgId: null }));
  }
}

interface ClerkClaims {
  sub?: unknown;
  org_id?: unknown;
  o?: { id?: unknown } | undefined;
}

export class ClerkAuthVerifier implements AuthVerifier {
  readonly mode = "clerk" as const;

  constructor(
    private readonly options: { secretKey: string; authorizedParties: string[] },
    private readonly verify_: typeof verifyToken = verifyToken,
  ) {}

  async verify(header: string | undefined): Promise<Result<VerifiedIdentity, AuthFailure>> {
    const token = bearer(header);
    if (!token) return err({ code: "UNAUTHENTICATED", detail: "missing bearer token" });
    try {
      const claims = (await this.verify_(token, {
        secretKey: this.options.secretKey,
        authorizedParties: this.options.authorizedParties,
      })) as ClerkClaims;
      if (typeof claims.sub !== "string") return err({ code: "INVALID_TOKEN", detail: "token has no subject" });
      const orgClaim = typeof claims.org_id === "string" ? claims.org_id : claims.o?.id;
      return ok({ subject: claims.sub, externalOrgId: typeof orgClaim === "string" ? orgClaim : null });
    } catch {
      // Never echo token contents or provider error text to the caller.
      return err({ code: "INVALID_TOKEN", detail: "token verification failed" });
    }
  }
}

export interface AuthConfig {
  mode: "dev" | "clerk";
  nodeEnv: string | undefined;
  clerkSecretKey?: string | undefined;
  clerkAuthorizedParties?: string[] | undefined;
}

export function createAuthVerifier(config: AuthConfig): AuthVerifier {
  switch (config.mode) {
    case "dev":
      return new DevAuthVerifier(config.nodeEnv);
    case "clerk":
      if (!config.clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required when AUTH_MODE=clerk");
      return new ClerkAuthVerifier({
        secretKey: config.clerkSecretKey,
        authorizedParties: config.clerkAuthorizedParties ?? [],
      });
  }
}

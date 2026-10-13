import { cookies } from "next/headers";
import { z } from "zod";

/**
 * Web session. In development (`ARF_AUTH_MODE=dev`) the user picks a seeded
 * development identity and the BFF sends `Bearer dev:<subject>`; the API
 * refuses dev tokens in production. Clerk sessions are verified by the API;
 * the Clerk front-end integration is listed as a limitation of this slice.
 */
export const SESSION_COOKIE = "arf_session";

export const DEV_USERS = [
  { subject: "dev|researcher", label: "Riley Researcher", roles: "Researcher · Developer" },
  { subject: "dev|committee", label: "Casey Committee", roles: "Committee member · Validator" },
  { subject: "dev|operator", label: "Oakley Operator", roles: "Operator" },
  { subject: "dev|viewer", label: "Vic Viewer", roles: "Viewer" },
  { subject: "dev|admin", label: "Ari Admin", roles: "Admin" },
] as const;

const SessionSchema = z.object({
  subject: z.string().regex(/^dev\|[a-z]+$/),
  org: z.string().regex(/^[a-z0-9-]{3,60}$/),
});
export type Session = z.infer<typeof SessionSchema>;

export function authMode(): "dev" | "clerk" {
  return process.env.ARF_AUTH_MODE === "clerk" ? "clerk" : "dev";
}

export function parseSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

export async function currentSession(): Promise<Session | null> {
  if (authMode() !== "dev") return null;
  const jar = await cookies();
  return parseSession(jar.get(SESSION_COOKIE)?.value);
}

export function authHeaders(session: Session): Record<string, string> {
  return { authorization: `Bearer dev:${session.subject}`, "x-arf-org": session.org };
}

export function userLabel(subject: string): string {
  return DEV_USERS.find((u) => u.subject === subject)?.label ?? subject;
}

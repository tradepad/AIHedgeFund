import "server-only";
import type { z } from "zod";
import { ProblemDetailsSchema, type ProblemDetails } from "@arf/contracts";
import { authHeaders, currentSession } from "./session";

export const API_URL = process.env.ARF_API_URL ?? "http://127.0.0.1:4000";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: ProblemDetails };

function problem(status: number, detail: string): ProblemDetails {
  return {
    type: "about:blank",
    title: "Request failed",
    status,
    detail,
    instance: "",
    code: "WEB_REQUEST_FAILED",
    traceId: "",
  };
}

/**
 * Server-side read from the API on behalf of the signed-in user. Responses are
 * validated against the shared contracts; problems are returned, never thrown, so pages
 * can render explicit error states.
 */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>> {
  const session = await currentSession();
  if (!session) return { ok: false, problem: problem(401, "sign in to continue") };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: authHeaders(session), cache: "no-store" });
  } catch {
    return { ok: false, problem: problem(503, "the ARF API is unreachable") };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ProblemDetailsSchema.safeParse(body);
    return {
      ok: false,
      problem: parsed.success ? parsed.data : problem(res.status, "unexpected API response"),
    };
  }
  const data = schema.safeParse(body);
  if (!data.success)
    return { ok: false, problem: problem(502, "the API response did not match its contract") };
  return { ok: true, data: data.data };
}

"use client";

import type { z } from "zod";
import { ProblemDetailsSchema, type ProblemDetails } from "@arf/contracts";

export type ClientResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; problem: ProblemDetails };

const BASE = "/arf-api";

function fallback(status: number, detail: string): ProblemDetails {
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

async function toResult<T>(res: Response, schema: z.ZodType<T>): Promise<ClientResult<T>> {
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const data = schema.safeParse(body);
    return data.success
      ? { ok: true, data: data.data, status: res.status }
      : { ok: false, problem: fallback(502, "response did not match its contract") };
  }
  const parsed = ProblemDetailsSchema.safeParse(body);
  return {
    ok: false,
    problem: parsed.success ? parsed.data : fallback(res.status, "unexpected response"),
  };
}

export async function clientGet<T>(path: string, schema: z.ZodType<T>): Promise<ClientResult<T>> {
  try {
    return await toResult(await fetch(`${BASE}${path}`, { cache: "no-store" }), schema);
  } catch {
    return { ok: false, problem: fallback(503, "network error") };
  }
}

/**
 * Send a command. Each logical command carries one idempotency key; callers
 * reuse the key when retrying the same submission so it is applied once.
 */
export async function clientCommand<T>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  idempotencyKey: string,
  schema: z.ZodType<T>,
): Promise<ClientResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
    return await toResult(res, schema);
  } catch {
    return { ok: false, problem: fallback(503, "network error") };
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

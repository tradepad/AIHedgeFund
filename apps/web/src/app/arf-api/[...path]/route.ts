import { type NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/server-api";
import { authHeaders, currentSession } from "@/lib/session";

/**
 * Backend-for-frontend proxy. The browser never holds an API credential: the
 * session cookie is exchanged for the API Authorization header here.
 * Commands must be same-origin (CSRF). Only `/v1/...` paths are forwarded.
 */
export const dynamic = "force-dynamic";

const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "last-event-id", "traceparent"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "x-trace-id", "idempotency-replayed", "retry-after"];

function problem(status: number, code: string, detail: string): NextResponse {
  return NextResponse.json({ type: "about:blank", title: "Request rejected", status, detail, instance: "", code, traceId: "" }, { status, headers: { "content-type": "application/problem+json" } });
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && new URL(origin).host === request.headers.get("host");
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  if (path[0] !== "v1" || path.some((p) => p === ".." || p.includes("\\"))) return problem(404, "NOT_FOUND", "unknown API path");
  const isUpload = path[1] === "object-uploads";
  if (request.method !== "GET" && !sameOrigin(request)) return problem(403, "CSRF_REJECTED", "cross-site requests are not allowed");

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  if (!isUpload) {
    const session = await currentSession();
    if (!session) return problem(401, "UNAUTHENTICATED", "sign in to continue");
    Object.assign(headers, authHeaders(session));
  }
  const target = `${API_URL}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return problem(503, "API_UNAVAILABLE", "the ARF API is unreachable");
  }
  const out = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;

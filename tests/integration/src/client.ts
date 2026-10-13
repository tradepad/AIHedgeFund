import { randomUUID } from "node:crypto";

export type DevUser = "researcher" | "committee" | "operator" | "viewer" | "admin" | "outsider";

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** Minimal typed-at-the-edge HTTP client for the API, acting as a seeded development user. */
export class ApiClient {
  constructor(
    readonly baseUrl: string,
    readonly user: DevUser,
    readonly org = "arf-dev",
  ) {}

  as(user: DevUser, org = this.org): ApiClient {
    return new ApiClient(this.baseUrl, user, org);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer dev:dev|${this.user}`, "x-arf-org": this.org, ...extra };
  }

  async get<T = Record<string, unknown>>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    return { status: res.status, body: (await res.json()) as T, headers: res.headers };
  }

  async send<T = Record<string, unknown>>(method: "POST" | "PUT", path: string, body: unknown, idempotencyKey: string = randomUUID()): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers({ "content-type": "application/json", "idempotency-key": idempotencyKey }),
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T, headers: res.headers };
  }

  post<T = Record<string, unknown>>(path: string, body: unknown, key?: string) {
    return this.send<T>("POST", path, body, key);
  }

  put<T = Record<string, unknown>>(path: string, body: unknown, key?: string) {
    return this.send<T>("PUT", path, body, key);
  }
}

export function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  if (res.status !== status) throw new Error(`expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

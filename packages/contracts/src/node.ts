import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical";

/** Server-only helpers. Import from `@arf/contracts/node`. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Deterministic UUID (RFC 9562 version 8) derived from a name. Used for event
 * ids produced by retryable jobs, so a retry yields the same id and the
 * outbox's unique key absorbs the duplicate.
 */
export function deterministicUuid(name: string): string {
  const h = createHash("sha256").update(name).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x80;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

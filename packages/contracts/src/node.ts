import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical";

/** Server-only helpers. Import from `@arf/contracts/node`. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

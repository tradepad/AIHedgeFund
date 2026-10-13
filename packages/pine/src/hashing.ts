import { canonicalJson, type PineManifest } from "@arf/contracts";
import { sha256Hex } from "@arf/contracts/node";

/**
 * Pine source identity. Line endings are normalised to LF so the same script
 * saved on Windows and Unix hashes identically; nothing else is altered, so
 * any semantic or whitespace change inside lines produces a new hash.
 */
export function normalisePineSource(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

export function pineSourceHash(source: string): string {
  return sha256Hex(normalisePineSource(source));
}

export function pineManifestHash(manifest: PineManifest): string {
  return sha256Hex(canonicalJson(manifest));
}

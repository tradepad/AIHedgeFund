import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const fixture = (name: string): Uint8Array => readFileSync(join(repoRoot, "pine", "fixtures", "tradingview", name));
export const csv = (text: string): Uint8Array => new TextEncoder().encode(text);

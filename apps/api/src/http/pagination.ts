import { z } from "zod";
import { problems } from "./problem";

export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T extends z.ZodType>(
  schema: T,
  cursor: string | undefined,
): z.infer<T> | null {
  if (!cursor) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  throw problems.badRequest("INVALID_CURSOR", "cursor is malformed");
}

export const IdCursor = z.object({ id: z.uuid() });
export const SeqCursor = z.object({ seq: z.number().int() });
export const TradeCursor = z.object({ n: z.number().int() });
export const UpdatedCursor = z.object({ t: z.iso.datetime(), id: z.uuid() });

/** Split a page fetched with limit + 1 rows into items and next cursor. */
export function page<T>(
  rows: T[],
  limit: number,
  cursorOf: (last: T) => Record<string, string | number>,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}

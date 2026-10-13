export type Delimiter = "," | ";" | "\t";

export interface CsvTable {
  delimiter: Delimiter;
  /** Raw cell text, row 0 is the header. Row numbers in messages are 1-based file rows. */
  rows: string[][];
}

export type CsvFailure =
  | { code: "ENCODING_ERROR"; detail: string }
  | { code: "EMPTY_REPORT"; detail: string }
  | { code: "MALFORMED_CSV"; detail: string }
  | { code: "AMBIGUOUS_DELIMITER"; detail: string };

/** Decode bytes as UTF-8 (BOM stripped) or UTF-16LE when a UTF-16 BOM is present. Invalid UTF-8 is rejected. */
export function decodeText(bytes: Uint8Array): { ok: true; text: string } | { ok: false; error: CsvFailure } {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { ok: true, text: new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)) };
    }
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start)) };
  } catch {
    return { ok: false, error: { code: "ENCODING_ERROR", detail: "file is not valid UTF-8 or UTF-16LE text" } };
  }
}

/** RFC 4180 parser for a known delimiter. Quoted fields may contain delimiters, quotes ("") and newlines. */
export function parseCsv(text: string, delimiter: Delimiter): { ok: true; rows: string[][] } | { ok: false; error: CsvFailure } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field.length > 0) {
        return { ok: false, error: { code: "MALFORMED_CSV", detail: `unexpected quote in unquoted field on row ${rows.length + 1}` } };
      }
      inQuotes = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (inQuotes) return { ok: false, error: { code: "MALFORMED_CSV", detail: "unterminated quoted field" } };
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { ok: true, rows: rows.filter((r) => !(r.length === 1 && r[0]?.trim() === "")) };
}

/**
 * Detect the delimiter by parsing with each candidate and keeping those where
 * the header has at least two columns and every row has the header's width.
 * More than one consistent candidate is ambiguous and rejected.
 */
export function readCsv(bytes: Uint8Array): { ok: true; table: CsvTable } | { ok: false; error: CsvFailure } {
  const decoded = decodeText(bytes);
  if (!decoded.ok) return decoded;
  if (decoded.text.trim().length === 0) return { ok: false, error: { code: "EMPTY_REPORT", detail: "file is empty" } };
  const candidates: CsvTable[] = [];
  for (const delimiter of [",", ";", "\t"] as const) {
    const parsed = parseCsv(decoded.text, delimiter);
    if (!parsed.ok) continue;
    const [header, ...body] = parsed.rows;
    if (!header || header.length < 2) continue;
    if (body.every((r) => r.length === header.length)) candidates.push({ delimiter, rows: parsed.rows });
  }
  if (candidates.length === 0) {
    return { ok: false, error: { code: "MALFORMED_CSV", detail: "no delimiter yields a consistent table" } };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      error: { code: "AMBIGUOUS_DELIMITER", detail: `consistent with several delimiters: ${candidates.map((c) => JSON.stringify(c.delimiter)).join(", ")}` },
    };
  }
  const [table] = candidates;
  if (!table || table.rows.length < 2) return { ok: false, error: { code: "EMPTY_REPORT", detail: "report has a header but no rows" } };
  return { ok: true, table };
}

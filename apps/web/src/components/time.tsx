/** UTC timestamps are shown in UTC with an explicit suffix; no local-time conversion. */
export function Utc({ value }: { value: string | null }) {
  if (!value) return <span className="muted">—</span>;
  return <time dateTime={value}>{value.replace("T", " ").replace("Z", " UTC")}</time>;
}

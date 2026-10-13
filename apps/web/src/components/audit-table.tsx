import Link from "next/link";
import type { AuditEvent } from "@arf/contracts";
import { EmptyState } from "@arf/ui";
import { Utc } from "./time";

/** Append-only, hash-chained audit trail. State summaries are shown as structured JSON text. */
export function AuditTable({ events, nextHref }: { events: AuditEvent[]; nextHref: string | null }) {
  if (events.length === 0) return <EmptyState title="No audit events" />;
  return (
    <div className="card">
      <table data-testid="audit-table">
        <thead>
          <tr>
            <th>#</th>
            <th>When</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Aggregate</th>
            <th>Change</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="mono">{e.seq}</td>
              <td>
                <Utc value={e.createdAt} />
              </td>
              <td className="mono">{e.action}</td>
              <td className="mono">{e.actorType === "USER" ? `user ${e.actorId.slice(0, 8)}` : e.actorId}</td>
              <td className="mono">
                {e.aggregateType.toLowerCase()} {e.aggregateId.slice(0, 8)}
              </td>
              <td className="mono">
                {e.priorState ? JSON.stringify(e.priorState) : "∅"} → {e.newState ? JSON.stringify(e.newState) : "∅"}
              </td>
              <td>{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row spread muted">
        <span className="mono">chain head {events[0]?.hash.slice(0, 16)}…</span>
        {nextHref ? <Link href={nextHref}>Older events →</Link> : null}
      </div>
    </div>
  );
}

import Link from "next/link";
import { z } from "zod";
import { VerificationSchema, type StrategyVersion } from "@arf/contracts";
import { EmptyState } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { CreateVerification } from "./create-verification";

export async function VerificationTab({ version }: { version: StrategyVersion }) {
  const res = await apiGet(
    `/v1/strategy-versions/${version.id}/verifications`,
    z.object({ items: z.array(VerificationSchema) }),
  );
  if (!res.ok) return <ProblemView problem={res.problem} />;
  const canCreate =
    version.state === "TRADINGVIEW_VERIFICATION" &&
    res.data.items.every((v) => v.status === "PARSE_FAILED");
  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>TradingView verifications</h2>
        {res.data.items.length === 0 ? (
          <EmptyState title="No verification yet" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Verification</th>
                <th>Status</th>
                <th>Window</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link href={`/verifications/${v.id}`} data-testid="verification-link">
                      {v.id.slice(0, 13)}…
                    </Link>
                  </td>
                  <td>{v.status.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="mono">
                    {v.settings.dateFrom} → {v.settings.dateTo} ({v.settings.chartTimezone})
                  </td>
                  <td>
                    <Utc value={v.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {canCreate ? <CreateVerification versionId={version.id} /> : null}
    </div>
  );
}

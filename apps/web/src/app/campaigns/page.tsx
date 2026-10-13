import Link from "next/link";
import { CampaignSchema, pageOf } from "@arf/contracts";
import { EmptyState } from "@arf/ui";
import { ProblemView } from "@/components/problem";
import { Utc } from "@/components/time";
import { apiGet } from "@/lib/server-api";
import { CreateCampaign } from "./create-campaign";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const res = await apiGet(
    `/v1/campaigns?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    pageOf(CampaignSchema),
  );
  return (
    <div className="grid grid-2">
      <div className="stack">
        <h1>Campaigns</h1>
        {!res.ok ? (
          <ProblemView problem={res.problem} />
        ) : res.data.items.length === 0 ? (
          <EmptyState title="No campaigns yet">
            Create the first campaign to start research.
          </EmptyState>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Assets</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/campaigns/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.assetClasses.join(", ")}</td>
                    <td>{c.status.toLowerCase()}</td>
                    <td>
                      <Utc value={c.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {res.data.nextCursor ? (
              <Link href={`/campaigns?cursor=${encodeURIComponent(res.data.nextCursor)}`}>
                Older campaigns →
              </Link>
            ) : null}
          </div>
        )}
      </div>
      <CreateCampaign />
    </div>
  );
}

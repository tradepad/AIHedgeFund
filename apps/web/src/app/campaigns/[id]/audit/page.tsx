import { AuditEventSchema, pageOf } from "@arf/contracts";
import { AuditTable } from "@/components/audit-table";
import { ProblemView } from "@/components/problem";
import { apiGet } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function CampaignAudit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { id } = await params;
  const { cursor } = await searchParams;
  const res = await apiGet(
    `/v1/campaigns/${id}/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    pageOf(AuditEventSchema),
  );
  if (!res.ok) return <ProblemView problem={res.problem} />;
  return (
    <div className="stack">
      <h1>Campaign audit history</h1>
      <AuditTable
        events={res.data.items}
        nextHref={
          res.data.nextCursor
            ? `/campaigns/${id}/audit?cursor=${encodeURIComponent(res.data.nextCursor)}`
            : null
        }
      />
    </div>
  );
}

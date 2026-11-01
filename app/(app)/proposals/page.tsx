import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { listProposals, proposalSummary } from "@/lib/services/proposals";
import { Empty, PageHeader, Panel, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { draft: "", sent: "border-accent text-accent", accepted: "border-ok/60 text-ok", declined: "border-danger/60 text-danger", expired: "text-muted" };

export default async function ProposalsPage() {
  const ctx = await dashboardCtx("/proposals");
  const proposals = await listProposals(ctx);
  const open = proposals.filter((p) => p.status === "sent");
  const openValue = open.reduce((a, p) => a + proposalSummary(p).firstYearNetPence, 0);
  const decided = proposals.filter((p) => p.status === "accepted" || p.status === "declined");
  const winRate = decided.length ? Math.round((decided.filter((p) => p.status === "accepted").length / decided.length) * 100) : null;

  return (
    <div className="space-y-5">
      <PageHeader label="Sales" title="Proposals" sub="Write, price and print proposals; mirror them to Xero quotes; turn accepted ones into draft invoices.">
        <Link href="/proposals/new" className="btn btn-primary btn-sm">New proposal</Link>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Awaiting decision" value={String(open.length)} sub={`${formatGbpFromPence(openValue)} first-year value`} />
        <Stat label="Win rate" value={winRate === null ? "—" : `${winRate}%`} sub={`${decided.length} decided`} />
        <Stat label="Total proposals" value={String(proposals.length)} />
      </div>
      <Panel>
        {proposals.length === 0 ? (
          <Empty action={<Link href="/proposals/new" className="btn btn-primary btn-sm">Create your first proposal</Link>}>No proposals yet. You can also ask Jarvis in Claude: “draft a website proposal for World of Beds”.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {proposals.map((p) => {
              const t = proposalSummary(p);
              return (
                <li key={p.id}>
                  <Link href={`/proposals/${p.id}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-mono text-xs text-muted">{p.number}</span> <span className="font-medium">{p.title}</span>
                      <span className="block text-sm text-muted">{p.client_name} · issued {formatUkDate(p.issue_date)}{p.valid_until ? ` · valid until ${formatUkDate(p.valid_until)}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-sm tabular-nums">{formatGbpFromPence(t.oneOffNetPence)}{t.monthlyNetPence ? ` + ${formatGbpFromPence(t.monthlyNetPence)}/mo` : ""}</span>
                      <span className={`badge ${TONE[p.status]}`}>{p.status}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

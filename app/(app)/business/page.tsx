import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { NAV_ICONS } from "@/lib/nav";
import { crm, crmConfigured } from "@/lib/crm/client";
import { loadRevenue } from "@/lib/services/revenue";
import { listProposals, proposalSummary } from "@/lib/services/proposals";
import { taxSetAside, upcomingDeadlines } from "@/lib/services/tax";
import { FlagList, PageHeader, Panel, SectionTitle, Tile } from "@/components/ui";

export const dynamic = "force-dynamic";

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));
async function safe<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export default async function BusinessPage() {
  const ctx = await dashboardCtx("/business");
  const [r, proposals, deadlines, setAside, pipeline, { count: clientCount }] = await Promise.all([
    safe(() => loadRevenue(ctx)),
    safe(() => listProposals(ctx)),
    safe(() => upcomingDeadlines(ctx, { days: 120 })),
    safe(() => taxSetAside(ctx)),
    crmConfigured() ? safe(() => crm<{ quoted_pipeline: { first_year: number; count: number } }>("overview")) : Promise.resolve(null),
    ctx.sb.from("clients").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId).eq("status", "active"),
  ]);
  const s = r?.hasData ? r.summary("this_month") : null;
  const flags = r?.hasData ? r.flags() : [];
  const open = (proposals ?? []).filter((p) => p.status === "sent");
  const next = deadlines?.find((d) => !d.done);

  return (
    <div className="space-y-6 fade-in">
      <PageHeader label="Business" title="Qevero at a glance" sub="Tap any tile to go deeper. Ask Jarvis “what needs attention?” for advice." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/revenue" label="Revenue · this month" icon={NAV_ICONS.revenue} value={s ? gbp(s.total) : "—"} sub={s?.growth.projectedMonth ? `On pace for ${gbp(s.growth.projectedMonth)}` : "Connect Xero"} />
        <Tile href="/revenue" label="Recurring (MRR)" icon={NAV_ICONS.revenue} value={s ? gbp(s.recurring.mrr) : "—"} sub={s ? `ARR ${gbp(s.recurring.arr)}` : undefined} />
        <Tile href="/invoices" label="Overdue" icon={NAV_ICONS.invoice} value={s ? gbp(s.debtors.overdue) : "—"} tone={s && s.debtors.overdue > 0 ? "danger" : undefined} sub={s ? `${gbp(s.debtors.total)} owed in total` : undefined} />
        <Tile href="/tax" label="Set aside for tax" icon={NAV_ICONS.tax} value={setAside ? gbp(setAside.total) : "—"} sub="VAT + corporation tax (estimate)" />
        <Tile href="/proposals" label="Proposals out" icon={NAV_ICONS.proposal} value={String(open.length)} sub={open.length ? `${formatGbpFromPence(open.reduce((a, p) => a + proposalSummary(p).firstYearNetPence, 0))} first-year value` : "None awaiting a decision"} />
        <Tile href="/crm" label="Quoted pipeline" icon={NAV_ICONS.crm} value={pipeline ? gbp(Number(pipeline.quoted_pipeline.first_year)) : "—"} sub={pipeline ? `${pipeline.quoted_pipeline.count} leads in the CRM` : "Connect the CRM"} />
        <Tile href="/tax" label="Next deadline" icon={NAV_ICONS.tax} value={next ? `${next.daysAway}d` : "—"} tone={next && next.daysAway <= 14 ? "warn" : undefined} sub={next ? `${next.title.split(" (")[0]} · ${formatUkDate(next.due)}` : undefined} />
        <Tile href="/clients" label="Active clients" icon={NAV_ICONS.clients} value={String(clientCount ?? 0)} sub="Retainers and Xero links" />
      </div>

      <section>
        <SectionTitle>Needs attention</SectionTitle>
        <Panel><FlagList flags={flags} /></Panel>
      </section>

      <section>
        <SectionTitle>Everything business</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["/invoices?tab=new", "New invoice"], ["/invoices?tab=po", "New purchase order"], ["/proposals/new", "New proposal"], ["/vault", "Company Vault"]].map(([href, label]) => (
            <a key={href} href={href} className="btn btn-ghost">{label}</a>
          ))}
        </div>
      </section>
    </div>
  );
}

import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate, formatUkDateTime } from "@/lib/dates";
import { crm, crmConfigured, crmLink } from "@/lib/crm/client";
import { BarList } from "@/components/charts";
import { Empty, PageHeader, Panel, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type Overview = {
  counts: Record<string, number>;
  quoted_pipeline: { count: number; one_off: number; monthly: number; first_year: number };
  by_stage: { stage: string; leads: number; first_year: number }[];
  won_90d: { count: number; first_year: number };
  lost_90d: number;
  lead_deadlines_14d: { id: string; title: string; company: string | null; deadline: string; label: string | null; stage: string }[];
  recent_activity: { occurred_at: string; type: string; subject: string | null; company: string | null; direction: string | null }[];
};
type Task = { id: string; title: string; due_at: string | null; overdue: boolean; lead: string | null; company: string | null; assignee: string | null };
type Tender = { title: string; buyer_name: string; value_amount: number | null; deadline: string | null; status: string; notice_url: string; search_service: string | null };

const gbp = (n: number) => formatGbpFromPence(Math.round(Number(n) * 100));

export default async function CrmPage() {
  await dashboardCtx("/crm");
  const header = <PageHeader label="Sales" title="CRM" sub="Read-only view of Qevero's CRM (leads, pipeline, tasks, tenders)." />;
  if (!crmConfigured()) {
    return (<div>{header}<Empty>The CRM connector isn&apos;t set up yet. See README → “Qevero CRM connector” (one SQL script in the CRM&apos;s Supabase plus three environment variables).</Empty></div>);
  }
  let data: [Overview, Task[], Tender[]];
  try {
    data = await Promise.all([crm<Overview>("overview"), crm<Task[]>("tasks", { days: 7 }), crm<Tender[]>("tenders", { limit: 15 })]);
  } catch (e) {
    return (<div>{header}<Empty>{e instanceof Error ? e.message : "The CRM connector failed."}</Empty></div>);
  }
  const [o, tasks, tenders] = data;
  const winRate = o.won_90d.count + o.lost_90d ? Math.round((o.won_90d.count / (o.won_90d.count + o.lost_90d)) * 100) : null;
  const open = crmLink("/");

  return (
    <div className="space-y-5">
      {header}
      {open && <a href={open} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open the CRM ↗</a>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Quoted pipeline" value={gbp(o.quoted_pipeline.first_year)} sub={`${o.quoted_pipeline.count} leads · first-year value`} />
        <Stat label="Won · 90 days" value={gbp(o.won_90d.first_year)} sub={`${o.won_90d.count} won${winRate !== null ? ` · ${winRate}% win rate` : ""}`} />
        <Stat label="CRM tasks overdue" value={String(o.counts.tasks_overdue ?? 0)} tone={(o.counts.tasks_overdue ?? 0) > 0 ? "warn" : undefined} sub={`${o.counts.tasks_due_today ?? 0} due today`} />
        <Stat label="Tenders closing ≤7d" value={String(o.counts.tenders_closing_7d ?? 0)} sub={`${o.counts.tenders_new ?? 0} new matches`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Open pipeline by stage (first-year value)">
          <BarList rows={o.by_stage.map((s) => ({ label: `${s.stage} (${s.leads})`, value: Number(s.first_year) }))} />
        </Panel>
        <Panel title="CRM tasks · next 7 days">
          {tasks.length === 0 ? <Empty>No CRM tasks due.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {tasks.map((t) => (
                <li key={t.id} className="flex justify-between gap-3 py-2">
                  <span>{t.title}<span className="block text-xs text-muted">{[t.company, t.lead].filter(Boolean).join(" · ")}{t.assignee ? ` · ${t.assignee}` : ""}</span></span>
                  <span className={`shrink-0 text-xs ${t.overdue ? "text-danger" : "text-muted"}`}>{t.due_at ? formatUkDate(t.due_at) : "no date"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Tenders (open matches)">
          {tenders.length === 0 ? <Empty>No open tender matches.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {tenders.map((t, i) => (
                <li key={i} className="py-2">
                  <a href={t.notice_url} target="_blank" rel="noreferrer" className="hover:text-accent">{t.title}</a>
                  <p className="text-xs text-muted">{t.buyer_name} · {t.value_amount ? gbp(t.value_amount) : "value not stated"} · closes {t.deadline ? formatUkDate(t.deadline) : "—"} · {t.status}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted">Contains public sector information licensed under the Open Government Licence v3.0.</p>
        </Panel>
        <Panel title="Lead deadlines & recent activity">
          <ul className="mb-4 divide-y divide-line text-sm">
            {o.lead_deadlines_14d.map((l) => <li key={l.id} className="flex justify-between gap-3 py-2"><span>{l.title}<span className="block text-xs text-muted">{l.company} · {l.stage}</span></span><span className="text-xs">{l.label ?? "Deadline"} {formatUkDate(l.deadline)}</span></li>)}
            {!o.lead_deadlines_14d.length && <li className="py-2 text-muted">No lead deadlines in the next 14 days.</li>}
          </ul>
          <ul className="space-y-1 text-xs text-muted">
            {o.recent_activity.map((a, i) => <li key={i}>{formatUkDateTime(a.occurred_at)} · {a.type.replace(/_/g, " ")}{a.direction === "inbound" ? " ↘" : a.direction === "outbound" ? " ↗" : ""} · {a.subject ?? ""}{a.company ? ` (${a.company})` : ""}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

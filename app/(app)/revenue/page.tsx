import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDateTime } from "@/lib/dates";
import { connectionStatus } from "@/lib/integrations/connections";
import { lastMonths, monthLabel, PERIOD_KEYS, type PeriodKey } from "@/lib/periods";
import { monthlySeries } from "@/lib/revenue/analytics";
import { STREAMS, UNASSIGNED } from "@/lib/revenue/streams";
import { loadRevenue } from "@/lib/services/revenue";
import { lastSync } from "@/lib/xero/sync";
import { BarList, StackedBars } from "@/components/charts";
import { NEUTRAL, SERIES_COLOURS } from "@/lib/chart-colours";
import { ActionForm } from "@/components/forms";
import { ConnectPrompt, Empty, FlagList, PageHeader, Panel, Stat } from "@/components/ui";
import { syncXeroAction } from "../actions";

export const dynamic = "force-dynamic";

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));
const LABELS: Record<PeriodKey, string> = { this_month: "This month", last_month: "Last month", this_quarter: "This quarter", last_quarter: "Last quarter", ytd: "Year to date", last_year: "Last FY", last_12_months: "12 months", all: "All" };

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await dashboardCtx("/revenue");
  const { period: p } = await searchParams;
  const period = (PERIOD_KEYS.includes(p as PeriodKey) ? p : "this_month") as PeriodKey;
  const [r, xero, sync] = await Promise.all([loadRevenue(ctx), connectionStatus(ctx, "xero"), lastSync(ctx)]);

  const header = (
    <PageHeader label="Revenue" title="Revenue & analytics" sub={sync?.last_success_at ? `From Xero · last synced ${formatUkDateTime(sync.last_success_at)}` : "Calculated in code from your Xero data"}>
      <Link href="/revenue/mapping" className="btn btn-ghost btn-sm">Stream mapping</Link>
      {xero?.status === "active" && (
        <ActionForm action={syncXeroAction} submit="Sync now" className="flex items-center">
          <span />
        </ActionForm>
      )}
    </PageHeader>
  );

  if (!r.hasData) {
    return (
      <div>
        {header}
        {xero?.status === "active" ? <Empty>No invoices synced yet. Press “Sync now”, or raise your first invoice from Invoices.</Empty> : <ConnectPrompt what="Xero" />}
      </div>
    );
  }

  const s = r.summary(period);
  const byStream = r.byStream(period);
  const clients = r.clients("last_12_months");
  const flags = r.flags();
  const months = lastMonths(r.today, 12);
  const ids = [...STREAMS.map((x) => x.id as string), UNASSIGNED];
  const streamSeries = ids
    .map((id, i) => ({ id, label: id === UNASSIGNED ? "Unassigned" : STREAMS[i].label, colour: id === UNASSIGNED ? NEUTRAL : SERIES_COLOURS[i], values: monthlySeries(r.rev, months, id).map((m) => m.net) }))
    .filter((x) => x.values.some((v) => v !== 0));
  const mix = monthlySeries(r.rev, months);
  const g = s.growth;

  return (
    <div className="space-y-5">
      {header}
      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Period">
        {PERIOD_KEYS.map((k) => (
          <Link key={k} href={`/revenue?period=${k}`} className={`btn btn-sm whitespace-nowrap ${k === period ? "btn-primary" : "btn-ghost"}`}>{LABELS[k]}</Link>
        ))}
      </nav>
      <p className="text-xs text-muted">{s.period.label} · net of VAT, by invoice date</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={gbp(s.total)} sub={period === "this_month" && g.projectedMonth !== null ? `On pace for ${gbp(g.projectedMonth)}` : undefined} />
        <Stat label="Recurring (MRR)" value={gbp(s.recurring.mrr)} sub={`ARR ${gbp(s.recurring.arr)} · ${monthLabel(s.recurring.month)}`} />
        <Stat label="Last month vs 3-mo avg" value={g.vsTrailingPct === null ? "—" : `${g.vsTrailingPct > 0 ? "+" : ""}${g.vsTrailingPct}%`} tone={g.vsTrailingPct !== null && g.vsTrailingPct < 0 ? "warn" : "ok"} sub={g.lastComplete ? `${monthLabel(g.lastComplete.month)}: ${gbp(g.lastComplete.net)}` : undefined} />
        <Stat label="Overdue debtors" value={gbp(s.debtors.overdue)} tone={s.debtors.overdue > 0 ? "danger" : undefined} sub={`Total owed ${gbp(s.debtors.total)}`} />
      </div>

      <Panel title="Needs attention">
        <FlagList flags={flags} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Revenue by stream · last 12 months">
          <StackedBars title="Monthly revenue by stream" categories={months.map(monthLabel)} series={streamSeries} />
        </Panel>
        <Panel title="Recurring vs one-off · last 12 months">
          <StackedBars title="Recurring vs one-off revenue" categories={months.map(monthLabel)} series={[{ id: "rec", label: "Recurring", colour: SERIES_COLOURS[0], values: mix.map((m) => m.recurring) }, { id: "one", label: "One-off", colour: SERIES_COLOURS[1], values: mix.map((m) => m.oneOff) }]} />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={`Streams · ${LABELS[period]}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-1.5 font-normal">Stream</th><th className="py-1.5 text-right font-normal">Revenue</th><th className="py-1.5 text-right font-normal">Share</th><th className="py-1.5 text-right font-normal">Avg invoice</th></tr></thead>
              <tbody>
                {byStream.streams.map((x) => {
                  const avg = byStream.averageDealSize.find((a) => a.stream === x.stream);
                  return (
                    <tr key={x.stream} className="border-t border-line">
                      <td className="py-2">{x.label}{x.recurring && <span className="badge ml-2">Recurring</span>}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{gbp(x.net)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{x.share}%</td>
                      <td className="py-2 text-right font-mono tabular-nums">{avg?.invoices ? gbp(avg.average) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Top clients · last 12 months">
          <p className="mb-3 text-xs text-muted">Concentration: top client {clients.top1Share}% · top 3 {clients.top3Share}% of {gbp(clients.total)}</p>
          <BarList rows={clients.clients.slice(0, 8).map((c) => ({ label: c.name, value: c.net, note: `${c.share}%` }))} />
        </Panel>
      </div>

      <Panel title="Aged debtors">
        {(() => {
          const a = r.aged();
          return a.items.length === 0 ? (
            <p className="text-sm text-muted">Nobody owes you anything right now.</p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-5 gap-2 text-center text-xs">
                {Object.entries(a.buckets).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line p-2"><p className="text-muted">{k === "current" ? "Not due" : `${k} days`}</p><p className="font-mono tabular-nums">{gbp(v)}</p></div>
                ))}
              </div>
              <ul className="divide-y divide-line text-sm">
                {a.items.slice(0, 10).map((i) => (
                  <li key={i.invoiceId} className="flex justify-between gap-3 py-2">
                    <span>{i.contactName} <span className="text-muted">{i.number}</span></span>
                    <span className={`font-mono tabular-nums ${i.daysOverdue > 30 ? "text-danger" : i.daysOverdue > 0 ? "text-warn" : ""}`}>{gbp(i.amountDue)} · {i.daysOverdue > 0 ? `${i.daysOverdue}d late` : "not due"}</span>
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
      </Panel>
    </div>
  );
}

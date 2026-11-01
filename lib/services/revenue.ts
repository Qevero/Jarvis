import { getPrefs, vaultValues, type Ctx } from "@/lib/ctx";
import { todayUk } from "@/lib/dates";
import { fyStartMonthFromYearEnd, lastMonths, resolvePeriod, type PeriodKey } from "@/lib/periods";
import { agedDebtors, averageDealSize, buildRevenueLines, clientBreakdown, growth, latePayers, monthlySeries, recurringRunRate, revenueByStream, totalRevenue } from "@/lib/revenue/analytics";
import { attentionFlags, type ProposalLite, type RetainerClient } from "@/lib/revenue/flags";
import { STREAMS, isStreamId, streamLabel, suggestStream } from "@/lib/revenue/streams";
import type { InvoiceRow, LineRow } from "@/lib/revenue/types";

/** Loads the Xero mirror once per request and answers revenue questions from it. */

async function all<T>(ctx: Ctx, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb.from(table).select(columns).eq("owner_id", ctx.ownerId).range(from, from + 999);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadRevenue(ctx: Ctx) {
  const [invoices, lines, maps, overrides, clients, proposals, prefs, vault] = await Promise.all([
    all<InvoiceRow>(ctx, "xero_invoices", "*"),
    all<LineRow>(ctx, "xero_invoice_lines", "*"),
    all<{ account_code: string; stream: string }>(ctx, "stream_account_map", "account_code, stream"),
    all<{ line_key: string; stream: string }>(ctx, "stream_line_overrides", "line_key, stream"),
    all<{ name: string; xero_contact_id: string | null; retainer_monthly_pence: number | null; status: string }>(ctx, "clients", "name, xero_contact_id, retainer_monthly_pence, status"),
    all<ProposalLite>(ctx, "proposals", "number, title, client_name, status, sent_at, valid_until"),
    getPrefs(ctx),
    vaultValues(ctx),
  ]);
  const accountMap = Object.fromEntries(maps.map((m) => [m.account_code, m.stream]));
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.line_key, o.stream]));
  const rev = buildRevenueLines(invoices, lines, accountMap, overrideMap);
  const retainers: RetainerClient[] = clients.filter((c) => c.status === "active" && (c.retainer_monthly_pence ?? 0) > 0).map((c) => ({ name: c.name, xeroContactId: c.xero_contact_id, monthlyPence: c.retainer_monthly_pence }));
  const today = todayUk();
  const fyStart = fyStartMonthFromYearEnd(vault.accounting_year_end);
  const period = (key: PeriodKey) => resolvePeriod(key, today, fyStart);

  return {
    today,
    invoices,
    lines,
    rev,
    prefs,
    accountMap,
    period,
    hasData: invoices.length > 0,

    summary(key: PeriodKey = "this_month") {
      const p = period(key);
      const series = monthlySeries(rev, lastMonths(today, 6));
      return {
        period: p,
        total: totalRevenue(rev, p.start, p.end),
        byStream: revenueByStream(rev, p.start, p.end),
        recurring: recurringRunRate(rev, today),
        growth: growth(series, today),
        monthly: series,
        debtors: (({ total, overdue, buckets }) => ({ total, overdue, buckets }))(agedDebtors(invoices, today)),
        dataAsOf: invoices.reduce<string | null>((a, i) => (i.updated_utc && (!a || i.updated_utc > a) ? i.updated_utc : a), null),
      };
    },
    byStream(key: PeriodKey = "this_month") {
      const p = period(key);
      return { period: p, ...revenueByStream(rev, p.start, p.end), averageDealSize: averageDealSize(rev, p.start, p.end) };
    },
    clients(key: PeriodKey = "last_12_months") {
      const p = period(key);
      return { period: p, ...clientBreakdown(rev, p.start, p.end, 15), latePayers: latePayers(invoices).slice(0, 10) };
    },
    aged() {
      return { ...agedDebtors(invoices, today), latePayers: latePayers(invoices) };
    },
    flags() {
      return attentionFlags({ lines: rev, invoices, today, prefs, retainers, proposals });
    },
    trend(stream: string | null, months = 12) {
      if (stream && !isStreamId(stream)) throw new Error(`Unknown stream "${stream}". Use one of: ${STREAMS.map((s) => s.id).join(", ")}.`);
      const series = monthlySeries(rev, lastMonths(today, Math.min(Math.max(months, 2), 36)), stream ?? undefined);
      return { stream: stream ? streamLabel(stream) : "All streams", series, growth: growth(series, today) };
    },
    unmapped() {
      const lineByKey = new Map(lines.map((l) => [`${l.invoice_id}:${l.line_item_id}`, l]));
      return rev
        .filter((r) => r.stream === "unassigned")
        .map((r) => ({ ...r, suggestion: suggestStream(r.description), accountCode: lineByKey.get(r.key)?.account_code ?? null }))
        .sort((a, b) => b.date.localeCompare(a.date));
    },
  };
}

export type RevenueData = Awaited<ReturnType<typeof loadRevenue>>;

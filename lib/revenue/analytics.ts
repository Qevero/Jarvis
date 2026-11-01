import { addMonths, daysInMonth, inRange, monthKey, monthRange, monthStart, parts } from "@/lib/periods";
import { daysBetween } from "@/lib/dates";
import { STREAMS, UNASSIGNED, isRecurringStream, matchStreamOption, streamLabel } from "./streams";
import { POSTED, type InvoiceRow, type LineRow, type RevenueLine } from "./types";

/**
 * Revenue analytics. Pure, deterministic functions over mirrored Xero data:
 * revenue is recognised on the invoice date (accruals), net of VAT, in GBP.
 * Only AUTHORISED and PAID sales invoices and credit notes count.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (part: number, total: number) => (total > 0 ? round2((part / total) * 100) : 0);

export function buildRevenueLines(
  invoices: InvoiceRow[],
  lines: LineRow[],
  accountMap: Record<string, string> = {},
  overrides: Record<string, string> = {},
): RevenueLine[] {
  const inv = new Map(invoices.map((i) => [i.invoice_id, i]));
  const out: RevenueLine[] = [];
  for (const line of lines) {
    const i = inv.get(line.invoice_id);
    if (!i || !i.date || !POSTED.has(i.status)) continue;
    if (i.type !== "ACCREC" && i.type !== "ACCRECCREDIT") continue;
    const sign = i.type === "ACCRECCREDIT" ? -1 : 1;
    const rate = Number(i.currency_rate) > 0 ? Number(i.currency_rate) : 1;
    const key = `${line.invoice_id}:${line.line_item_id}`;

    let stream: string = UNASSIGNED;
    let streamSource: RevenueLine["streamSource"] = "none";
    const fromTracking = matchStreamOption(line.stream_option);
    if (overrides[key]) {
      stream = overrides[key];
      streamSource = "override";
    } else if (fromTracking) {
      stream = fromTracking;
      streamSource = "tracking";
    } else if (line.account_code && accountMap[line.account_code]) {
      stream = accountMap[line.account_code];
      streamSource = "account";
    }

    out.push({
      key,
      invoiceId: i.invoice_id,
      number: i.number,
      contactId: i.contact_id,
      contactName: i.contact_name ?? "Unknown",
      date: i.date,
      stream,
      streamSource,
      net: round2((sign * Number(line.net_amount)) / rate),
      recurring: isRecurringStream(stream) || Boolean(i.repeating_invoice_id),
      accountCode: line.account_code,
      description: line.description,
    });
  }
  return out;
}

const within = (lines: RevenueLine[], start: string, end: string) => lines.filter((l) => inRange(l.date, start, end));
const sum = (lines: { net: number }[]) => round2(lines.reduce((a, l) => a + l.net, 0));

export function totalRevenue(lines: RevenueLine[], start: string, end: string): number {
  return sum(within(lines, start, end));
}

export function revenueByStream(lines: RevenueLine[], start: string, end: string) {
  const scoped = within(lines, start, end);
  const total = sum(scoped);
  const ids = [...STREAMS.map((s) => s.id as string), UNASSIGNED];
  return {
    total,
    streams: ids
      .map((id) => {
        const net = sum(scoped.filter((l) => l.stream === id));
        return { stream: id, label: streamLabel(id), net, share: pct(net, total), recurring: isRecurringStream(id) };
      })
      .filter((s) => s.stream !== UNASSIGNED || s.net !== 0),
  };
}

export type MonthPoint = { month: string; net: number; recurring: number; oneOff: number };

export function monthlySeries(lines: RevenueLine[], months: string[], stream?: string): MonthPoint[] {
  const scoped = stream ? lines.filter((l) => l.stream === stream) : lines;
  return months.map((month) => {
    const m = scoped.filter((l) => monthKey(l.date) === month);
    const recurring = sum(m.filter((l) => l.recurring));
    const net = sum(m);
    return { month, net, recurring, oneOff: round2(net - recurring) };
  });
}

/** Growth figures for a series whose last point is the current (possibly partial) month. */
export function growth(series: MonthPoint[], today: string) {
  const n = series.length;
  if (n < 2) return { lastComplete: null, previous: null, momPct: null, trailing3Avg: null, vsTrailingPct: null, monthToDate: null, projectedMonth: null };
  const current = series[n - 1];
  const lastComplete = series[n - 2];
  const previous = n >= 3 ? series[n - 3] : null;
  const trailing = series.slice(Math.max(0, n - 5), n - 2);
  const trailing3Avg = trailing.length ? round2(trailing.reduce((a, p) => a + p.net, 0) / trailing.length) : null;
  const [y, m, d] = parts(today);
  const projectedMonth = round2((current.net / d) * daysInMonth(y, m));
  return {
    lastComplete,
    previous,
    momPct: previous && previous.net !== 0 ? round2(((lastComplete.net - previous.net) / Math.abs(previous.net)) * 100) : null,
    trailing3Avg,
    vsTrailingPct: trailing3Avg ? round2(((lastComplete.net - trailing3Avg) / Math.abs(trailing3Avg)) * 100) : null,
    monthToDate: current.net,
    projectedMonth,
  };
}

export function clientBreakdown(lines: RevenueLine[], start: string, end: string, limit = 10) {
  const scoped = within(lines, start, end);
  const total = sum(scoped);
  const map = new Map<string, { contactId: string | null; name: string; net: number; invoices: Set<string>; streams: Set<string> }>();
  for (const l of scoped) {
    const k = l.contactId ?? l.contactName;
    const cur = map.get(k) ?? { contactId: l.contactId, name: l.contactName, net: 0, invoices: new Set(), streams: new Set() };
    cur.net += l.net;
    cur.invoices.add(l.invoiceId);
    cur.streams.add(l.stream);
    map.set(k, cur);
  }
  const clients = [...map.values()]
    .map((c) => ({ contactId: c.contactId, name: c.name, net: round2(c.net), share: pct(c.net, total), invoices: c.invoices.size, streams: [...c.streams].map(streamLabel) }))
    .sort((a, b) => b.net - a.net);
  const top1 = clients[0]?.net ?? 0;
  const top3 = clients.slice(0, 3).reduce((a, c) => a + c.net, 0);
  return { total, clientCount: clients.length, top1Share: pct(top1, total), top3Share: pct(top3, total), clients: clients.slice(0, limit) };
}

/** Average invoice value per stream (net, per invoice that includes the stream). */
export function averageDealSize(lines: RevenueLine[], start: string, end: string) {
  const scoped = within(lines, start, end).filter((l) => l.net > 0);
  return STREAMS.map((s) => {
    const m = scoped.filter((l) => l.stream === s.id);
    const byInvoice = new Map<string, number>();
    for (const l of m) byInvoice.set(l.invoiceId, (byInvoice.get(l.invoiceId) ?? 0) + l.net);
    const count = byInvoice.size;
    const total = sum(m);
    return { stream: s.id, label: s.label, invoices: count, total, average: count ? round2(total / count) : 0 };
  });
}

export type AgedBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGED_BUCKETS: AgedBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

export function bucketFor(daysOverdue: number): AgedBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

/** Unpaid sales invoices, by how far past their due date they are. */
export function agedDebtors(invoices: InvoiceRow[], today: string) {
  const open = invoices.filter((i) => i.type === "ACCREC" && i.status === "AUTHORISED" && Number(i.amount_due) > 0);
  const items = open
    .map((i) => {
      const daysOverdue = i.due_date ? daysBetween(i.due_date, today) : 0;
      const rate = Number(i.currency_rate) > 0 ? Number(i.currency_rate) : 1;
      return {
        invoiceId: i.invoice_id,
        number: i.number,
        contactId: i.contact_id,
        contactName: i.contact_name ?? "Unknown",
        date: i.date,
        dueDate: i.due_date,
        amountDue: round2(Number(i.amount_due) / rate),
        daysOverdue,
        bucket: bucketFor(daysOverdue),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
  const buckets = Object.fromEntries(AGED_BUCKETS.map((b) => [b, round2(items.filter((i) => i.bucket === b).reduce((a, i) => a + i.amountDue, 0))])) as Record<AgedBucket, number>;
  const total = round2(items.reduce((a, i) => a + i.amountDue, 0));
  const overdue = round2(total - buckets.current);
  return { total, overdue, buckets, items };
}

/** Customers who pay late: average days between due date and full payment. */
export function latePayers(invoices: InvoiceRow[], minInvoices = 1) {
  const paid = invoices.filter((i) => i.type === "ACCREC" && i.status === "PAID" && i.due_date && i.fully_paid_on);
  const map = new Map<string, { name: string; days: number[] }>();
  for (const i of paid) {
    const k = i.contact_id ?? i.contact_name ?? "?";
    const cur = map.get(k) ?? { name: i.contact_name ?? "Unknown", days: [] };
    cur.days.push(daysBetween(i.due_date!, i.fully_paid_on!));
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([contactId, v]) => ({
      contactId,
      name: v.name,
      invoices: v.days.length,
      averageDaysLate: round2(v.days.reduce((a, d) => a + d, 0) / v.days.length),
      paidLate: v.days.filter((d) => d > 0).length,
    }))
    .filter((p) => p.invoices >= minInvoices && p.averageDaysLate > 0)
    .sort((a, b) => b.averageDaysLate - a.averageDaysLate);
}

/** Recurring revenue in the last complete month, as a monthly run rate (MRR) and annualised. */
export function recurringRunRate(lines: RevenueLine[], today: string) {
  const lastMonth = addMonths(monthStart(today), -1);
  const months = monthRange(lastMonth, lastMonth);
  const [p] = monthlySeries(lines, months);
  return { month: p.month, mrr: p.recurring, arr: round2(p.recurring * 12) };
}

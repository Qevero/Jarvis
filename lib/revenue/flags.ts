import { daysBetween, formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { addDays, addMonths, lastMonths, monthKey, monthStart, parts } from "@/lib/periods";
import type { Prefs } from "@/lib/settings-defaults";
import { agedDebtors, clientBreakdown, monthlySeries, round2 } from "./analytics";
import { STREAMS, UNASSIGNED, isRecurringStream, streamLabel } from "./streams";
import type { InvoiceRow, RevenueLine } from "./types";

/**
 * "Needs attention" flags: simple, explainable rules over the numbers.
 * Claude reads these through get_attention_flags and explains/recommends.
 */

export type Severity = "high" | "medium" | "low";
export type Flag = { id: string; rule: string; severity: Severity; title: string; detail: string; data?: Record<string, unknown> };

export type RetainerClient = { name: string; xeroContactId: string | null; monthlyPence: number | null };
export type ProposalLite = { number: string; title: string; client_name: string; status: string; sent_at: string | null; valid_until: string | null };

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));
const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function attentionFlags(input: {
  lines: RevenueLine[];
  invoices: InvoiceRow[];
  today: string;
  prefs: Prefs;
  retainers?: RetainerClient[];
  proposals?: ProposalLite[];
}): Flag[] {
  const { lines, invoices, today, prefs } = input;
  const flags: Flag[] = [];

  // 1. Stream down vs trailing average (last complete month vs the 3 months before it).
  const months = lastMonths(today, 5);
  for (const s of STREAMS) {
    const series = monthlySeries(lines, months, s.id);
    const last = series[3];
    const trailing = series.slice(0, 3);
    const avg = round2(trailing.reduce((a, p) => a + p.net, 0) / 3);
    if (avg < prefs.streamDropMinAverage) continue;
    const change = round2(((last.net - avg) / avg) * 100);
    if (change <= -prefs.streamDropPct) {
      flags.push({
        id: `stream_drop:${s.id}:${last.month}`,
        rule: "stream_drop",
        severity: change <= -2 * prefs.streamDropPct ? "high" : "medium",
        title: `${s.label} down ${Math.abs(change)}%`,
        detail: `${s.label} made ${gbp(last.net)} in ${last.month}, against a 3-month average of ${gbp(avg)}.`,
        data: { stream: s.id, month: last.month, net: last.net, trailingAverage: avg, changePct: change },
      });
    }
  }

  // 2. Overdue invoices.
  const aged = agedDebtors(invoices, today);
  const overdue = aged.items.filter((i) => i.daysOverdue > prefs.overdueDays);
  if (overdue.length) {
    const total = round2(overdue.reduce((a, i) => a + i.amountDue, 0));
    const worst = overdue[0];
    flags.push({
      id: `overdue:${today}`,
      rule: "overdue_invoices",
      severity: overdue.some((i) => i.daysOverdue > 30) ? "high" : "medium",
      title: `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} (${gbp(total)})`,
      detail: `Oldest: ${worst.number ?? "invoice"} for ${worst.contactName}, ${gbp(worst.amountDue)}, ${worst.daysOverdue} days overdue.`,
      data: { count: overdue.length, total, invoices: overdue.slice(0, 10) },
    });
  }

  // 3. Client concentration over the last 12 months.
  const start12 = addMonths(monthStart(today), -11);
  const cb = clientBreakdown(lines, start12, today, 3);
  if (cb.total >= prefs.concentrationMinRevenue && cb.clients.length) {
    if (cb.top1Share > prefs.concentrationTop1Pct) {
      flags.push({
        id: `concentration_top1:${monthKey(today)}`,
        rule: "concentration",
        severity: cb.top1Share > prefs.concentrationTop1Pct + 20 ? "high" : "medium",
        title: `${cb.clients[0].name} is ${cb.top1Share}% of revenue`,
        detail: `Over the last 12 months your largest client brought in ${gbp(cb.clients[0].net)} of ${gbp(cb.total)}. Threshold: ${prefs.concentrationTop1Pct}%.`,
        data: { top1Share: cb.top1Share, client: cb.clients[0].name },
      });
    }
    if (cb.top3Share > prefs.concentrationTop3Pct && cb.clientCount > 3) {
      flags.push({
        id: `concentration_top3:${monthKey(today)}`,
        rule: "concentration",
        severity: "medium",
        title: `Top 3 clients are ${cb.top3Share}% of revenue`,
        detail: `${cb.clients.map((c) => c.name).join(", ")}. Threshold: ${prefs.concentrationTop3Pct}%.`,
        data: { top3Share: cb.top3Share },
      });
    }
  }

  // 4. Retainers not invoiced this month (after the grace day).
  const [, , day] = parts(today);
  if (day >= prefs.retainerGraceDay) {
    const thisMonth = monthKey(today);
    const invoicedThisMonth = new Set(
      invoices.filter((i) => i.type === "ACCREC" && i.status !== "VOIDED" && i.status !== "DELETED" && i.date && monthKey(i.date) === thisMonth).map((i) => i.contact_id ?? i.contact_name),
    );
    // Retainer clients: configured, or invoiced recurring-stream work in both of the previous two months.
    const prev = [monthKey(addMonths(monthStart(today), -1)), monthKey(addMonths(monthStart(today), -2))];
    const detected = new Map<string, string>();
    for (const c of new Set(lines.filter((l) => isRecurringStream(l.stream) && l.net > 0).map((l) => l.contactId ?? l.contactName))) {
      const months = new Set(lines.filter((l) => (l.contactId ?? l.contactName) === c && isRecurringStream(l.stream) && l.net > 0).map((l) => monthKey(l.date)));
      if (prev.every((m) => months.has(m))) detected.set(c, lines.find((l) => (l.contactId ?? l.contactName) === c)!.contactName);
    }
    for (const r of input.retainers ?? []) detected.set(r.xeroContactId ?? r.name, r.name);
    for (const [key, name] of detected) {
      if (!invoicedThisMonth.has(key)) {
        flags.push({
          id: `retainer:${key}:${thisMonth}`,
          rule: "retainer_not_invoiced",
          severity: "high",
          title: `${name}'s retainer isn't invoiced for ${formatUkDate(`${thisMonth}-01`).slice(3)}`,
          detail: `No sales invoice (including drafts) dated this month for ${name}.`,
          data: { client: name, month: thisMonth },
        });
      }
    }
  }

  // 5. Draft invoices sitting in Xero.
  const staleDrafts = invoices.filter((i) => i.type === "ACCREC" && i.status === "DRAFT" && i.date && daysBetween(i.date, today) > prefs.staleDraftDays);
  if (staleDrafts.length) {
    flags.push({
      id: `stale_drafts:${today}`,
      rule: "stale_drafts",
      severity: "medium",
      title: `${staleDrafts.length} draft invoice${staleDrafts.length > 1 ? "s" : ""} not yet approved`,
      detail: `Drafts older than ${prefs.staleDraftDays} days: ${staleDrafts.slice(0, 5).map((i) => `${i.contact_name} (${gbp(Number(i.total))})`).join(", ")}. Approve and send them in Xero.`,
      data: { count: staleDrafts.length },
    });
  }

  // 6. Bills due within 7 days.
  const billsDue = invoices.filter((i) => i.type === "ACCPAY" && i.status === "AUTHORISED" && Number(i.amount_due) > 0 && i.due_date && i.due_date <= addDays(today, 7));
  if (billsDue.length) {
    const total = round2(billsDue.reduce((a, i) => a + Number(i.amount_due), 0));
    flags.push({
      id: `bills_due:${today}`,
      rule: "bills_due",
      severity: billsDue.some((i) => i.due_date! < today) ? "medium" : "low",
      title: `${billsDue.length} bill${billsDue.length > 1 ? "s" : ""} due within 7 days (${gbp(total)})`,
      detail: billsDue.slice(0, 5).map((i) => `${i.contact_name} ${gbp(Number(i.amount_due))} due ${formatUkDate(i.due_date)}`).join("; "),
      data: { count: billsDue.length, total },
    });
  }

  // 7. Revenue lines without a stream (last 3 months).
  const unassigned = lines.filter((l) => l.stream === UNASSIGNED && l.date >= addMonths(monthStart(today), -2));
  if (unassigned.length) {
    flags.push({
      id: `unassigned:${monthKey(today)}`,
      rule: "unassigned_revenue",
      severity: "low",
      title: `${unassigned.length} invoice line${unassigned.length > 1 ? "s" : ""} without a revenue stream`,
      detail: `${gbp(round2(unassigned.reduce((a, l) => a + l.net, 0)))} isn't tagged. Tag the lines in Xero (Revenue Stream) or map them on Revenue → Mapping.`,
      data: { count: unassigned.length },
    });
  }

  // 8. Proposals awaiting a decision.
  for (const p of input.proposals ?? []) {
    if (p.status === "sent" && p.sent_at && daysBetween(p.sent_at.slice(0, 10), today) >= prefs.proposalFollowUpDays) {
      flags.push({
        id: `proposal_follow_up:${p.number}`,
        rule: "proposal_follow_up",
        severity: p.valid_until && p.valid_until < today ? "medium" : "low",
        title: `Follow up ${p.number} with ${p.client_name}`,
        detail: `"${p.title}" was sent ${daysBetween(p.sent_at.slice(0, 10), today)} days ago with no decision${p.valid_until ? `; valid until ${formatUkDate(p.valid_until)}` : ""}.`,
      });
    }
  }

  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export { streamLabel };

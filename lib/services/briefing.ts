import type { Ctx } from "@/lib/ctx";
import { composeBriefing, journalPromptFor, type BriefingInput } from "@/lib/briefing/compose";
import { todayUk } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { connectionStatus } from "@/lib/integrations/connections";
import { GraphClient } from "@/lib/ms/graph";
import { crm, crmConfigured } from "@/lib/crm/client";
import { bankBalances } from "@/lib/xero/map";
import { cachedReport } from "@/lib/xero/sync";
import { loadRevenue } from "./revenue";
import { taxSetAside, upcomingDeadlines } from "./tax";

/**
 * Morning briefing: gathers today's calendar, tasks, money, deadlines and CRM
 * signals. Each source is optional — a missing integration just drops out.
 */

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function gatherBriefing(ctx: Ctx) {
  const today = todayUk();
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(new Date());
  const [ms, xero] = await Promise.all([connectionStatus(ctx, "microsoft"), connectionStatus(ctx, "xero")]);
  const graph = ms?.status === "active" ? new GraphClient(ctx) : null;

  const [calendar, tasks, revenue, deadlines, cash, setAside, crmOverview] = await Promise.all([
    graph ? safe(() => graph.calendar(today, today)) : null,
    graph ? safe(() => graph.listTasks()) : null,
    safe(() => loadRevenue(ctx)),
    safe(() => upcomingDeadlines(ctx, { days: 45 })),
    xero?.status === "active" ? safe(() => cachedReport(ctx, "bank_summary", 180, (x) => x.json("/Reports/BankSummary"))) : null,
    safe(() => taxSetAside(ctx)),
    crmConfigured() ? safe(() => crm<Record<string, unknown>>("overview")) : null,
  ]);

  const summary = revenue?.hasData ? revenue.summary("this_month") : null;
  const balances = cash ? bankBalances(cash.data as Record<string, unknown>) : null;
  const crmCounts = (crmOverview?.counts ?? {}) as Record<string, number>;
  const crmPipeline = (crmOverview?.quoted_pipeline ?? {}) as Record<string, number>;

  const input: BriefingInput = {
    today,
    weekday,
    calendar: calendar ? calendar.map((e) => ({ start: e.start, subject: e.subject, location: e.location, allDay: e.allDay })) : null,
    tasksDue: tasks ? tasks.filter((t) => t.due && t.due <= addDays(today, 1)).map((t) => ({ title: t.title, due: t.due, overdue: Boolean(t.due && t.due < today) })) : null,
    flags: revenue?.hasData ? revenue.flags().map((f) => ({ severity: f.severity, title: f.title })) : null,
    deadlines: deadlines ? deadlines.map((d) => ({ title: d.title, due: d.due, daysAway: d.daysAway, verified: d.verified })) : null,
    cash: balances ? { total: balances.reduce((a, b) => a + b.closing, 0), accounts: balances } : null,
    setAside: setAside && setAside.total > 0 ? { total: setAside.total } : null,
    revenue: summary ? { monthToDate: summary.total, lastMonth: summary.growth.lastComplete?.net ?? 0, projected: summary.growth.projectedMonth } : null,
    debtors: summary ? { overdue: summary.debtors.overdue, count: revenue!.aged().items.filter((i) => i.daysOverdue > 0).length } : null,
    crm: crmOverview ? { openTasksOverdue: crmCounts.tasks_overdue ?? 0, quotedPipeline: Number(crmPipeline.first_year ?? 0), tendersClosingSoon: crmCounts.tenders_closing_7d ?? 0 } : null,
    journalPrompt: journalPromptFor(today),
  };

  return {
    ...composeBriefing(input),
    data: input,
    integrations: { microsoft: ms?.status ?? "not_connected", xero: xero?.status ?? "not_connected", crm: crmConfigured() ? "configured" : "not_configured" },
  };
}

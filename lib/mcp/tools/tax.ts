import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { formatUkDate } from "@/lib/dates";
import { RULES } from "@/lib/tax/rules";
import { corporationTaxEstimate, markDeadlineDone, taxSetAside, upcomingDeadlines, vatReport } from "@/lib/services/tax";
import { run } from "../util";

export function registerTaxTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "get_upcoming_deadlines",
    {
      title: "Upcoming deadlines",
      description: "Compliance deadlines: VAT returns, corporation tax payment and CT600, Companies House accounts, confirmation statement, PAYE (if payroll), Self Assessment, and insurance/subscription renewals. 'verified: false' means the rule hasn't been confirmed with the accountant yet — say so. Jarvis tracks; it never files anything.",
      inputSchema: { days: z.number().int().min(1).max(730).optional().describe("Look-ahead, default 120"), include_done: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(async () => (await upcomingDeadlines(ctx, { days: a.days ?? 120, includeDone: a.include_done })).map((d) => ({ key: d.key, title: d.title, due: formatUkDate(d.due), days_away: d.daysAway, overdue: d.overdue, done: d.done, verified: d.verified, authority: d.authority, personal: d.personal ?? false, note: d.note, rule: RULES[d.ruleId].summary }))),
  );

  server.registerTool(
    "mark_deadline_done",
    { title: "Mark deadline done", description: "Mark a deadline as done (e.g. after the accountant confirms the VAT return was submitted). undo=true reopens it.", inputSchema: { key: z.string().describe("Deadline key from get_upcoming_deadlines"), note: z.string().max(500).optional(), undo: z.boolean().optional() } },
    async (a) => run(async () => markDeadlineDone(ctx, a.key, a.note, a.undo)),
  );

  server.registerTool(
    "get_vat_position",
    {
      title: "VAT position",
      description: "Estimated VAT return boxes (1, 4, 5, 6, 7) for a VAT quarter from Jarvis's copy of Xero (standard accrual scheme). quarter: current (default), previous, or a period end date (DD/MM/YYYY). An estimate — Xero's return is authoritative.",
      inputSchema: { quarter: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ quarter }) => run(async () => {
      const r = await vatReport(ctx, normaliseQuarter(quarter));
      return { period: { start: formatUkDate(r.period.start), end: formatUkDate(r.period.end) }, due: formatUkDate(r.dueDate), ...r.position, issues_count: r.issues.length, note: r.note };
    }),
  );

  server.registerTool(
    "get_vat_issues",
    { title: "VAT readiness issues", description: "Things to fix before the VAT return: lines missing VAT codes, odd 'No VAT' codings, bills without receipts, unreconciled bank lines, drafts in the period.", inputSchema: { quarter: z.string().optional() }, annotations: { readOnlyHint: true } },
    async ({ quarter }) => run(async () => {
      const r = await vatReport(ctx, normaliseQuarter(quarter));
      return { period: { start: formatUkDate(r.period.start), end: formatUkDate(r.period.end) }, issues: r.issues.map((i) => ({ ...i, date: formatUkDate(i.date) })) };
    }),
  );

  server.registerTool(
    "get_tax_set_aside",
    { title: "Money to set aside", description: "How much to keep aside for tax: VAT for the current (and any unpaid previous) quarter plus corporation tax accrued to date. Estimate only — not tax advice.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => taxSetAside(ctx)),
  );

  server.registerTool(
    "get_corporation_tax_estimate",
    { title: "Corporation tax estimate", description: "Running profit for the current CT accounting period, estimated CT to date and projected for the full period (19%/marginal relief/25%). Estimate only — not tax advice.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => corporationTaxEstimate(ctx)),
  );
}

function normaliseQuarter(q: string | undefined) {
  if (!q || q === "current" || q === "previous") return q ?? "current";
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(q.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : q;
}

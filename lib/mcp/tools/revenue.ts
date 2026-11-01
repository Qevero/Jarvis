import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { STREAM_IDS } from "@/lib/revenue/streams";
import { loadRevenue } from "@/lib/services/revenue";
import { bankBalances } from "@/lib/xero/map";
import { cachedReport, lastSync, syncXero } from "@/lib/xero/sync";
import type { PeriodKey } from "@/lib/periods";
import { periodSchema, run } from "../util";

const noData = { note: "No Xero data yet. Connect Xero in Jarvis → Settings, or run sync_xero." };

export function registerRevenueTools(server: McpServer, ctx: Ctx) {
  const load = () => loadRevenue(ctx);

  server.registerTool(
    "get_revenue_summary",
    {
      title: "Revenue summary",
      description: "Revenue for a period (net of VAT, invoice-date basis, from Xero): total, by stream, recurring run rate (MRR/ARR), growth vs last month and trailing average, month-to-date pace, last 6 months, and debtors. Use for 'how are we doing?'.",
      inputSchema: { period: periodSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ period }) => run(async () => {
      const r = await load();
      return r.hasData ? { ...r.summary((period as PeriodKey) ?? "this_month"), lastSync: await lastSync(ctx) } : noData;
    }),
  );

  server.registerTool(
    "get_revenue_by_stream",
    { title: "Revenue by stream", description: "Revenue split across Website Builds, SEO/GEO Retainers, Paid Media, Software & Hosting and Creative/Content, with shares and average deal size per stream.", inputSchema: { period: periodSchema }, annotations: { readOnlyHint: true } },
    async ({ period }) => run(async () => {
      const r = await load();
      return r.hasData ? r.byStream((period as PeriodKey) ?? "this_month") : noData;
    }),
  );

  server.registerTool(
    "get_client_breakdown",
    { title: "Client breakdown", description: "Top clients by revenue with concentration risk (% from the top 1 and top 3) and late payers. Default period: last 12 months.", inputSchema: { period: periodSchema }, annotations: { readOnlyHint: true } },
    async ({ period }) => run(async () => {
      const r = await load();
      return r.hasData ? r.clients((period as PeriodKey) ?? "last_12_months") : noData;
    }),
  );

  server.registerTool(
    "get_aged_debtors",
    { title: "Aged debtors", description: "Unpaid sales invoices bucketed by days overdue (current, 1–30, 31–60, 61–90, 90+), with each invoice and customers who habitually pay late.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => {
      const r = await load();
      return r.hasData ? r.aged() : noData;
    }),
  );

  server.registerTool(
    "get_attention_flags",
    {
      title: "Needs attention",
      description: "Rule-based 'needs attention' flags: streams down vs trailing average, overdue invoices, client concentration, retainers not invoiced this month, stale draft invoices, bills due, untagged revenue, proposals needing follow-up. Explain each and recommend actions.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => {
      const r = await load();
      return { flags: r.flags(), thresholds: r.prefs, dataAvailable: r.hasData };
    }),
  );

  server.registerTool(
    "get_trend",
    { title: "Revenue trend", description: "Monthly revenue series (recurring vs one-off) for one stream or all, with growth figures.", inputSchema: { stream: z.enum(STREAM_IDS as [string, ...string[]]).optional(), months: z.number().int().min(2).max(36).optional() }, annotations: { readOnlyHint: true } },
    async ({ stream, months }) => run(async () => {
      const r = await load();
      return r.hasData ? r.trend(stream ?? null, months ?? 12) : noData;
    }),
  );

  server.registerTool(
    "get_cash_position",
    { title: "Cash position", description: "Bank balances from Xero's Bank Summary (cached for 3 hours to save API calls).", inputSchema: { refresh: z.boolean().optional() }, annotations: { readOnlyHint: true } },
    async ({ refresh }) => run(async () => {
      const rep = await cachedReport(ctx, "bank_summary", refresh ? 0 : 180, (x) => x.json("/Reports/BankSummary"));
      const accounts = bankBalances(rep.data as Record<string, unknown>);
      return { accounts, total: Math.round(accounts.reduce((a, b) => a + b.closing, 0) * 100) / 100, asOf: rep.fetchedAt };
    }),
  );

  server.registerTool(
    "sync_xero",
    { title: "Refresh from Xero", description: "Pull the latest invoices, bills, credit notes, contacts and bank transactions from Xero now (incremental, within the daily call budget).", inputSchema: {} },
    async () => run(async () => syncXero(ctx, { budgetMs: 25_000 })),
  );
}

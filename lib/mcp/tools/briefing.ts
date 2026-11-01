import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { crmConfigured } from "@/lib/crm/client";
import { env } from "@/lib/env";
import { connectionStatus } from "@/lib/integrations/connections";
import { gatherBriefing } from "@/lib/services/briefing";
import { searchJournal } from "@/lib/services/journal";
import { recall, searchChats, memoryStats } from "@/lib/services/knowledge";
import { listProposals } from "@/lib/services/proposals";
import { lastSync } from "@/lib/xero/sync";
import { run } from "../util";

export function registerBriefingTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "get_morning_briefing",
    {
      title: "Morning briefing",
      description: "Jasper's daily briefing: today's calendar, tasks due, needs-attention flags, revenue month to date, overdue debtors, cash, tax set-aside, deadlines in 30 days, CRM pipeline and tenders, and a journal prompt. Read 'spoken' aloud in voice mode, then offer detail.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => {
      const b = await gatherBriefing(ctx);
      return { spoken: b.spoken, sections: b.sections, integrations: b.integrations };
    }),
  );

  server.registerTool(
    "jarvis_status",
    { title: "Jarvis status", description: "What's connected (Xero, Microsoft, CRM, Companies House, push), last Xero sync, and memory size. Use when something seems missing.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => ({
      xero: await connectionStatus(ctx, "xero"),
      xeroLastSync: await lastSync(ctx),
      microsoft: await connectionStatus(ctx, "microsoft"),
      crm: crmConfigured() ? "configured" : "not configured",
      companiesHouse: env.companiesHouseKey() ? "configured" : "not configured",
      memory: await memoryStats(ctx),
      dashboard: env.siteUrl(),
    })),
  );

  server.registerTool(
    "search_everything",
    { title: "Search everything", description: "One search across Jarvis: journal, memories, past Claude chats and proposals.", inputSchema: { query: z.string().min(2) }, annotations: { readOnlyHint: true } },
    async ({ query }) => run(async () => {
      const q = query.toLowerCase();
      const [journal, memories, chats, proposals] = await Promise.all([
        searchJournal(ctx, { query, limit: 5 }).catch(() => []),
        recall(ctx, { query, limit: 8 }).catch(() => []),
        searchChats(ctx, query, 5).catch(() => []),
        listProposals(ctx).then((ps) => ps.filter((p) => `${p.title} ${p.client_name} ${p.number}`.toLowerCase().includes(q)).slice(0, 5)).catch(() => []),
      ]);
      return {
        journal: journal.map((e) => ({ id: e.id, date: e.entry_date, title: e.title, summary: e.summary })),
        memories,
        past_chats: chats,
        proposals: proposals.map((p) => ({ id: p.id, number: p.number, title: p.title, client: p.client_name, status: p.status })),
      };
    }),
  );
}

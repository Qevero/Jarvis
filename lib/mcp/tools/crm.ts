import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { crm } from "@/lib/crm/client";
import { run } from "../util";

/** Read-only access to Qevero's internal CRM (leads, pipeline, tasks, tenders, companies). */
export function registerCrmTools(server: McpServer) {
  server.registerTool(
    "crm_overview",
    { title: "CRM overview", description: "From Qevero's CRM: quoted pipeline value, open leads by stage, wins/losses in 90 days, overdue CRM tasks, lead deadlines and tenders closing soon, recent activity.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => crm("overview")),
  );
  server.registerTool(
    "crm_leads",
    { title: "CRM leads", description: "Leads from the CRM (default: open), optionally by stage name or search text.", inputSchema: { status: z.enum(["open", "won", "lost", "on_hold", "all"]).optional(), stage: z.string().optional(), q: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("leads", a)),
  );
  server.registerTool(
    "crm_lead",
    { title: "CRM lead", description: "One CRM lead with open tasks and timeline (emails, calls, notes). Pass id, or q (lead title or company).", inputSchema: { id: z.string().uuid().optional(), q: z.string().optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("lead", a)),
  );
  server.registerTool(
    "crm_tasks",
    { title: "CRM tasks", description: "Open CRM tasks due within N days (default 7) plus overdue, with lead/company and assignee (Hen/Jas).", inputSchema: { days: z.number().int().min(0).max(90).optional(), limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("tasks", a)),
  );
  server.registerTool(
    "crm_tenders",
    { title: "CRM tenders", description: "Matched public tenders still open (new, reviewing, bidding), soonest deadline first.", inputSchema: { status: z.enum(["new", "reviewing", "bidding"]).optional(), limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("tenders", a)),
  );
  server.registerTool(
    "crm_search",
    { title: "CRM search", description: "Search CRM companies, contacts and leads by name or email.", inputSchema: { q: z.string().min(2) }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("search", a)),
  );
  server.registerTool(
    "crm_company",
    { title: "CRM company", description: "A CRM company with contacts, leads and recent activity. Pass id or q (name).", inputSchema: { id: z.string().uuid().optional(), q: z.string().optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("company", a)),
  );
  server.registerTool(
    "crm_activity",
    { title: "CRM activity", description: "Recent CRM timeline (emails, meetings, calls, stage changes) over N days.", inputSchema: { days: z.number().int().min(1).max(90).optional(), limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => crm("activity", a)),
  );
}

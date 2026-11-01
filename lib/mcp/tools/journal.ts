import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { blogDraftMarkdown, entryToText } from "@/lib/journal/format";
import { GraphClient } from "@/lib/ms/graph";
import { getJournalEntry, journalThemes, markActionPushed, saveJournalEntry, searchJournal } from "@/lib/services/journal";
import { confirmSchema, run } from "../util";

const actionItem = z.union([z.string(), z.object({ text: z.string(), due: z.string().optional().describe("DD/MM/YYYY or YYYY-MM-DD") })]);

export function registerJournalTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "save_journal_entry",
    {
      title: "Save journal entry",
      description:
        "Save a structured thought-journal entry from Jasper's free-form talk about the business. YOU structure it: a short title, a 2–4 sentence summary, themes/tags (lowercase, e.g. pricing, hiring, seo), decisions made, ideas, action items, and any clients mentioned. Include his raw notes (a faithful transcript or close paraphrase). After saving, offer to push action items to Microsoft To Do.",
      inputSchema: {
        title: z.string().min(1).max(300),
        summary: z.string().max(4000).optional(),
        raw_notes: z.string().max(50_000).optional(),
        themes: z.array(z.string()).max(20).optional(),
        decisions: z.array(z.string()).max(30).optional(),
        ideas: z.array(z.string()).max(30).optional(),
        action_items: z.array(actionItem).max(30).optional(),
        linked_clients: z.array(z.string()).max(30).optional(),
        entry_date: z.string().optional().describe("DD/MM/YYYY; defaults to today"),
        id: z.string().uuid().optional().describe("Pass to update an existing entry instead of creating one"),
      },
    },
    async (a) => run(async () => {
      const e = await saveJournalEntry(ctx, { ...a, action_items: a.action_items, source: "claude" }, a.id);
      return { saved: true, id: e.id, title: e.title, date: e.entry_date, themes: e.themes, action_items: e.action_items.map((x, i) => ({ index: i, ...x })) };
    }),
  );

  server.registerTool(
    "search_journal",
    {
      title: "Search journal",
      description: "Full-text search of Jasper's journal, optionally filtered by theme, client or date range (DD/MM/YYYY).",
      inputSchema: { query: z.string().optional(), theme: z.string().optional(), client: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(async () => (await searchJournal(ctx, a)).map((e) => ({ id: e.id, date: e.entry_date, title: e.title, summary: e.summary, themes: e.themes, clients: e.linked_clients }))),
  );

  server.registerTool(
    "get_journal_entry",
    { title: "Get journal entry", description: "One journal entry in full.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => run(async () => getJournalEntry(ctx, id)),
  );

  server.registerTool(
    "list_recent_journal",
    { title: "Recent journal", description: "The most recent journal entries (summaries).", inputSchema: { limit: z.number().int().min(1).max(30).optional() }, annotations: { readOnlyHint: true } },
    async ({ limit }) => run(async () => (await searchJournal(ctx, { limit: limit ?? 10 })).map(entryToText)),
  );

  server.registerTool(
    "journal_themes_over_time",
    { title: "Journal themes over time", description: "Which themes Jasper has been thinking about, month by month. Good for spotting what's on his mind or neglected.", inputSchema: { months: z.number().int().min(1).max(24).optional() }, annotations: { readOnlyHint: true } },
    async ({ months }) => run(async () => journalThemes(ctx, months ?? 6)),
  );

  server.registerTool(
    "push_journal_actions_to_tasks",
    {
      title: "Push journal actions to To Do",
      description: "Add a journal entry's action items to Microsoft To Do. Read the items back and get Jasper's yes first, then call with confirm=true.",
      inputSchema: { id: z.string().uuid(), indexes: z.array(z.number().int().min(0)).optional().describe("Which action items (default: all not yet pushed)"), list: z.string().optional().describe("To Do list name (default list if omitted)"), confirm: confirmSchema },
    },
    async ({ id, indexes, list, confirm }) => run(async () => {
      const entry = await getJournalEntry(ctx, id);
      const chosen = entry.action_items.map((a, i) => ({ ...a, i })).filter((a) => (indexes ? indexes.includes(a.i) : !a.pushed_task_id));
      if (!confirm) return { preview: true, will_add: chosen.map((a) => ({ title: a.text, due: a.due ?? null })), note: "Call again with confirm=true to add these to Microsoft To Do." };
      const graph = new GraphClient(ctx);
      const added = [];
      for (const a of chosen) {
        const t = await graph.addTask({ title: a.text, due: a.due ?? null, listName: list ?? null, notes: `From journal: ${entry.title}` });
        await markActionPushed(ctx, await getJournalEntry(ctx, id), a.i, t.id);
        added.push(t);
      }
      return { added };
    }),
  );

  server.registerTool(
    "journal_blog_draft",
    { title: "Journal → blog draft", description: "Turn a journal entry into a Markdown blog draft for qevero.com (client names left out unless include_clients). Claude can then polish the prose with Jasper.", inputSchema: { id: z.string().uuid(), include_clients: z.boolean().optional() }, annotations: { readOnlyHint: true } },
    async ({ id, include_clients }) => run(async () => blogDraftMarkdown(await getJournalEntry(ctx, id), { includeClients: include_clients })),
  );
}

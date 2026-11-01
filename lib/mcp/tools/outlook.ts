import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UserError, type Ctx } from "@/lib/ctx";
import { parseDate, todayUk } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { GraphClient } from "@/lib/ms/graph";
import { confirmSchema, run } from "../util";

/** "today" | "tomorrow" | "this_week" | "next_week" | "next_7_days" → ISO start/end (UK). */
export function resolveRange(range: string | undefined, start?: string, end?: string, today = todayUk()) {
  if (start) {
    const s = parseDate(start);
    const e = parseDate(end ?? start);
    if (!s || !e) throw new UserError("Use DD/MM/YYYY dates.");
    return { start: s, end: e };
  }
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  switch (range ?? "today") {
    case "today": return { start: today, end: today };
    case "tomorrow": return { start: addDays(today, 1), end: addDays(today, 1) };
    case "this_week": return { start: today, end: addDays(today, 6 - dow) };
    case "next_week": return { start: addDays(today, 7 - dow), end: addDays(today, 13 - dow) };
    case "next_7_days": return { start: today, end: addDays(today, 6) };
    default: throw new UserError("Unknown range.");
  }
}

function dateTime(v: string, label: string): string {
  const m = /^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v.trim());
  if (!m) throw new UserError(`${label}: use DD/MM/YYYY HH:MM.`);
  const d = parseDate(m[1]);
  if (!d) throw new UserError(`${label}: invalid date.`);
  return m[2] ? `${d}T${m[2].padStart(2, "0")}:${m[3]}:00` : d;
}

export function registerOutlookTools(server: McpServer, ctx: Ctx) {
  const graph = () => new GraphClient(ctx);

  server.registerTool(
    "list_tasks",
    { title: "List tasks", description: "Open tasks from Microsoft To Do (Jarvis's to-do list), soonest due first.", inputSchema: { list: z.string().optional(), include_completed: z.boolean().optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => graph().listTasks({ listName: a.list, includeCompleted: a.include_completed })),
  );

  server.registerTool(
    "add_task",
    {
      title: "Add task",
      description: "Add a task to Microsoft To Do, e.g. 'chase World of Beds on Friday' → title 'Chase World of Beds', due that Friday. Work out the date from today (Europe/London) and pass it as DD/MM/YYYY.",
      inputSchema: { title: z.string().min(1).max(255), due: z.string().optional().describe("DD/MM/YYYY"), notes: z.string().max(4000).optional(), list: z.string().optional(), reminder: z.string().optional().describe("DD/MM/YYYY HH:MM"), importance: z.enum(["low", "normal", "high"]).optional() },
    },
    async (a) => run(async () => graph().addTask({ title: a.title, due: a.due ? parseDate(a.due) ?? (() => { throw new UserError("Use DD/MM/YYYY for due."); })() : null, notes: a.notes, listName: a.list, reminder: a.reminder ? dateTime(a.reminder, "reminder") : null, importance: a.importance })),
  );

  server.registerTool(
    "complete_task",
    { title: "Complete task", description: "Mark a Microsoft To Do task complete (ids from list_tasks).", inputSchema: { list_id: z.string(), task_id: z.string() } },
    async (a) => run(async () => graph().completeTask(a.list_id, a.task_id)),
  );

  server.registerTool(
    "get_calendar",
    { title: "Calendar", description: "Outlook calendar events. range: today (default), tomorrow, this_week, next_week, next_7_days — or start/end dates (DD/MM/YYYY). Times are UK local.", inputSchema: { range: z.enum(["today", "tomorrow", "this_week", "next_week", "next_7_days"]).optional(), start: z.string().optional(), end: z.string().optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => {
      const r = resolveRange(a.range, a.start, a.end);
      return { ...r, events: await graph().calendar(r.start, r.end) };
    }),
  );

  server.registerTool(
    "create_calendar_event",
    {
      title: "Create calendar event",
      description: "Add an event to Jasper's own Outlook calendar (no attendees — Jarvis never sends invitations). Requires confirm=true after reading the details back.",
      inputSchema: { subject: z.string().min(1).max(255), start: z.string().describe("DD/MM/YYYY HH:MM (or a date for all-day)"), end: z.string().optional().describe("DD/MM/YYYY HH:MM; defaults to 1 hour after start"), all_day: z.boolean().optional(), location: z.string().optional(), notes: z.string().max(4000).optional(), confirm: confirmSchema },
    },
    async (a) => run(async () => {
      const start = dateTime(a.start, "start");
      let end = a.end ? dateTime(a.end, "end") : null;
      if (!end) end = start.length > 10 ? new Date(Date.parse(`${start}Z`) + 3_600_000).toISOString().slice(0, 19) : addDays(start, 1);
      if (!a.confirm) return { preview: true, subject: a.subject, start, end, all_day: Boolean(a.all_day), location: a.location ?? null, note: "Confirm with Jasper, then call with confirm=true." };
      return graph().createEvent({ subject: a.subject, start, end, allDay: a.all_day, location: a.location, notes: a.notes });
    }),
  );

  server.registerTool(
    "summarise_inbox",
    { title: "Inbox", description: "Recent Outlook inbox messages (sender, subject, preview, unread/flagged) for YOU to summarise for Jasper. Previews only.", inputSchema: { unread_only: z.boolean().optional(), since_hours: z.number().int().min(1).max(336).optional(), top: z.number().int().min(1).max(50).optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => graph().inbox({ unreadOnly: a.unread_only, sinceHours: a.since_hours ?? 48, top: a.top })),
  );

  server.registerTool(
    "search_email",
    { title: "Search email", description: "Search Outlook mail (all folders).", inputSchema: { query: z.string().min(2), top: z.number().int().min(1).max(25).optional() }, annotations: { readOnlyHint: true } },
    async (a) => run(async () => graph().searchMail(a.query, a.top)),
  );

  server.registerTool(
    "read_email",
    { title: "Read email", description: "Read one email's text (from summarise_inbox or search_email ids).", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } },
    async ({ id }) => run(async () => graph().readMessage(id)),
  );

  server.registerTool(
    "create_email_draft",
    { title: "Draft email", description: "Save a new email to Outlook Drafts. Jarvis NEVER sends email — Jasper reviews and sends it himself.", inputSchema: { to: z.array(z.string().email()).min(1), cc: z.array(z.string().email()).optional(), subject: z.string().min(1).max(255), body: z.string().min(1).max(20_000) } },
    async (a) => run(async () => graph().createDraft(a)),
  );

  server.registerTool(
    "create_reply_draft",
    { title: "Draft reply", description: "Save a reply (or reply-all) to an email in Outlook Drafts, quoting the original. Never sent.", inputSchema: { message_id: z.string(), body: z.string().min(1).max(20_000), reply_all: z.boolean().optional() } },
    async (a) => run(async () => graph().createReplyDraft(a.message_id, a.body, a.reply_all)),
  );
}

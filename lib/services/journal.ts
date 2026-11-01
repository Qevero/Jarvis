import { audit, UserError, type Ctx } from "@/lib/ctx";
import { parseDate, todayUk } from "@/lib/dates";
import { addMonths } from "@/lib/periods";
import { normaliseTags, themesOverTime, type ActionItem, type JournalEntry } from "@/lib/journal/format";

/** Thought journal service (shared by MCP tools and the dashboard). */

const COLUMNS = "id, entry_date, title, raw_notes, summary, themes, decisions, ideas, action_items, linked_clients, source, created_at";

export type JournalInput = {
  title: string;
  entry_date?: string | null;
  raw_notes?: string | null;
  summary?: string | null;
  themes?: string[];
  decisions?: string[];
  ideas?: string[];
  action_items?: (string | ActionItem)[];
  linked_clients?: string[];
  source?: "claude" | "dashboard" | "voice";
};

const clean = (xs: string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 30);

export async function saveJournalEntry(ctx: Ctx, input: JournalInput, id?: string) {
  const title = input.title?.trim();
  if (!title) throw new UserError("A journal entry needs a title.");
  const date = input.entry_date ? parseDate(input.entry_date) : todayUk();
  if (!date) throw new UserError("Use DD/MM/YYYY for the entry date.");
  const row = {
    owner_id: ctx.ownerId,
    title: title.slice(0, 300),
    entry_date: date,
    raw_notes: input.raw_notes?.trim() || null,
    summary: input.summary?.trim() || null,
    themes: normaliseTags(input.themes),
    decisions: clean(input.decisions),
    ideas: clean(input.ideas),
    action_items: (input.action_items ?? []).map((a) => (typeof a === "string" ? { text: a } : a)).filter((a) => a.text?.trim()).slice(0, 30),
    linked_clients: clean(input.linked_clients),
    source: input.source ?? (ctx.actor.source === "mcp" ? "claude" : "dashboard"),
  };
  const q = id ? ctx.sb.from("journal_entries").update(row).eq("id", id).eq("owner_id", ctx.ownerId) : ctx.sb.from("journal_entries").insert(row);
  const { data, error } = await q.select(COLUMNS).single();
  if (error) throw new Error(`Saving journal entry: ${error.message}`);
  await audit(ctx, id ? "journal.update" : "journal.save", data.id, { title: row.title, themes: row.themes });
  return data as JournalEntry;
}

export async function getJournalEntry(ctx: Ctx, id: string) {
  const { data, error } = await ctx.sb.from("journal_entries").select(COLUMNS).eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserError("Journal entry not found.");
  return data as JournalEntry;
}

export async function deleteJournalEntry(ctx: Ctx, id: string) {
  const { error } = await ctx.sb.from("journal_entries").delete().eq("owner_id", ctx.ownerId).eq("id", id);
  if (error) throw new Error(error.message);
  await audit(ctx, "journal.delete", id);
}

export async function searchJournal(ctx: Ctx, opts: { query?: string | null; theme?: string | null; client?: string | null; from?: string | null; to?: string | null; limit?: number }) {
  let q = ctx.sb.from("journal_entries").select(COLUMNS).eq("owner_id", ctx.ownerId).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(Math.min(opts.limit ?? 20, 100));
  if (opts.query?.trim()) q = q.textSearch("search", opts.query.trim(), { type: "websearch", config: "english" });
  if (opts.theme) q = q.contains("themes", [opts.theme.toLowerCase()]);
  if (opts.client) q = q.contains("linked_clients", [opts.client]);
  if (opts.from) q = q.gte("entry_date", parseDate(opts.from) ?? opts.from);
  if (opts.to) q = q.lte("entry_date", parseDate(opts.to) ?? opts.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as JournalEntry[];
}

export async function journalThemes(ctx: Ctx, months = 6) {
  const to = todayUk();
  const from = addMonths(to, -months);
  const { data, error } = await ctx.sb.rpc("journal_theme_counts", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return { from, to, ...themesOverTime((data ?? []) as { month: string; theme: string; entries: number }[]) };
}

export async function allThemesAndClients(ctx: Ctx) {
  const { data } = await ctx.sb.from("journal_entries").select("themes, linked_clients").eq("owner_id", ctx.ownerId).limit(1000);
  const themes = new Map<string, number>();
  const clients = new Map<string, number>();
  for (const r of data ?? []) {
    for (const t of r.themes ?? []) themes.set(t, (themes.get(t) ?? 0) + 1);
    for (const c of r.linked_clients ?? []) clients.set(c, (clients.get(c) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { themes: sorted(themes), clients: sorted(clients) };
}

/** Records that an action item was pushed to Microsoft To Do. */
export async function markActionPushed(ctx: Ctx, entry: JournalEntry, index: number, taskId: string) {
  const items = [...entry.action_items];
  if (!items[index]) throw new UserError("That action item doesn't exist.");
  items[index] = { ...items[index], pushed_task_id: taskId };
  await ctx.sb.from("journal_entries").update({ action_items: items }).eq("id", entry.id).eq("owner_id", ctx.ownerId);
}

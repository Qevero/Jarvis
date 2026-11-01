import { audit, UserError, type Ctx } from "@/lib/ctx";
import type { ParsedConversation } from "@/lib/knowledge/claude-export";

/** Jarvis's memory: durable knowledge items plus searchable imported Claude chats. */

export const KNOWLEDGE_KINDS = ["fact", "preference", "decision", "person", "client", "process", "idea", "goal", "lesson"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

const COLS = "id, kind, title, content, tags, importance, pinned, source, source_ref, created_at, updated_at";

export async function remember(ctx: Ctx, input: { title: string; content?: string; kind?: KnowledgeKind; tags?: string[]; importance?: number; pinned?: boolean; source?: string; sourceRef?: string | null }) {
  const title = input.title?.trim();
  if (!title) throw new UserError("Give the memory a short title.");
  // Update an existing item with the same title rather than duplicating it.
  const { data: existing } = await ctx.sb.from("knowledge_items").select("id").eq("owner_id", ctx.ownerId).ilike("title", title).maybeSingle();
  const row = {
    owner_id: ctx.ownerId,
    title: title.slice(0, 300),
    content: (input.content ?? "").trim().slice(0, 20_000),
    kind: input.kind ?? "fact",
    tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 15),
    importance: Math.min(5, Math.max(1, Math.round(input.importance ?? 3))),
    pinned: Boolean(input.pinned),
    source: input.source ?? (ctx.actor.source === "mcp" ? "claude_chat" : "dashboard"),
    source_ref: input.sourceRef ?? null,
  };
  const q = existing ? ctx.sb.from("knowledge_items").update(row).eq("id", existing.id) : ctx.sb.from("knowledge_items").insert(row);
  const { data, error } = await q.select(COLS).single();
  if (error) throw new Error(`Saving memory: ${error.message}`);
  await audit(ctx, existing ? "memory.update" : "memory.save", data.id, { title: row.title, kind: row.kind });
  return { ...data, updated: Boolean(existing) };
}

export async function forget(ctx: Ctx, id: string) {
  const { data, error } = await ctx.sb.from("knowledge_items").delete().eq("owner_id", ctx.ownerId).eq("id", id).select("title").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserError("Memory not found.");
  await audit(ctx, "memory.forget", id, { title: data.title });
  return { forgotten: data.title };
}

export async function recall(ctx: Ctx, opts: { query?: string | null; kind?: string | null; tag?: string | null; limit?: number; pinnedOnly?: boolean }) {
  let q = ctx.sb.from("knowledge_items").select(COLS).eq("owner_id", ctx.ownerId).order("pinned", { ascending: false }).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(Math.min(opts.limit ?? 20, 100));
  if (opts.query?.trim()) q = q.textSearch("search", opts.query.trim(), { type: "websearch", config: "english" });
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.tag) q = q.contains("tags", [opts.tag.toLowerCase()]);
  if (opts.pinnedOnly) q = q.eq("pinned", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Context pack for the start of a conversation: pinned and most important memories. */
export async function coreMemories(ctx: Ctx, limit = 25) {
  const { data } = await ctx.sb.from("knowledge_items").select("kind, title, content, tags").eq("owner_id", ctx.ownerId).or("pinned.eq.true,importance.gte.4").order("importance", { ascending: false }).limit(limit);
  return data ?? [];
}

export async function searchChats(ctx: Ctx, query: string, limit = 15) {
  if (!query.trim()) throw new UserError("Search for something.");
  const { data, error } = await ctx.sb.rpc("search_chat_messages", { p_query: query, p_limit: limit });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getConversation(ctx: Ctx, id: string, opts: { maxChars?: number } = {}) {
  const { data: conv } = await ctx.sb.from("chat_conversations").select("id, title, started_at, last_message_at, message_count, digest").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (!conv) throw new UserError("Conversation not found.");
  const { data: msgs } = await ctx.sb.from("chat_messages").select("sender, sent_at, body").eq("conversation_id", id).eq("owner_id", ctx.ownerId).order("position");
  const budget = opts.maxChars ?? 30_000;
  let used = 0;
  const messages: { sender: string; sent_at: string | null; body: string }[] = [];
  for (const m of msgs ?? []) {
    if (used > budget) {
      messages.push({ sender: "system", sent_at: null, body: `[${(msgs?.length ?? 0) - messages.length} more messages truncated]` });
      break;
    }
    used += m.body.length;
    messages.push(m);
  }
  return { ...conv, messages };
}

export async function listConversations(ctx: Ctx, opts: { undigestedOnly?: boolean; limit?: number; query?: string | null } = {}) {
  let q = ctx.sb.from("chat_conversations").select("id, title, started_at, last_message_at, message_count, digested_at").eq("owner_id", ctx.ownerId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(Math.min(opts.limit ?? 30, 200));
  if (opts.undigestedOnly) q = q.is("digested_at", null);
  if (opts.query) q = q.ilike("title", `%${opts.query.replace(/[%_]/g, "")}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Claude writes a short digest of a past chat after extracting its knowledge. */
export async function digestConversation(ctx: Ctx, id: string, digest: string) {
  const { error } = await ctx.sb.from("chat_conversations").update({ digest: digest.slice(0, 4000), digested_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).eq("id", id);
  if (error) throw new Error(error.message);
  await audit(ctx, "memory.digest_chat", id);
  return { id, digested: true };
}

export async function importConversations(ctx: Ctx, convs: ParsedConversation[]) {
  let conversations = 0, messages = 0;
  for (const c of convs) {
    const { data: conv, error } = await ctx.sb
      .from("chat_conversations")
      .upsert({ owner_id: ctx.ownerId, external_id: c.external_id, title: c.title.slice(0, 300), started_at: c.started_at, last_message_at: c.last_message_at, message_count: c.messages.length }, { onConflict: "owner_id,external_id" })
      .select("id")
      .single();
    if (error) throw new Error(`Importing "${c.title}": ${error.message}`);
    for (let i = 0; i < c.messages.length; i += 200) {
      const chunk = c.messages.slice(i, i + 200).map((m) => ({ owner_id: ctx.ownerId, conversation_id: conv.id, external_id: m.external_id, position: m.position, sender: m.sender, sent_at: m.sent_at, body: m.body }));
      const { error: mErr } = await ctx.sb.from("chat_messages").upsert(chunk, { onConflict: "owner_id,external_id" });
      if (mErr) throw new Error(`Importing messages: ${mErr.message}`);
    }
    conversations++;
    messages += c.messages.length;
  }
  await audit(ctx, "memory.import_chats", null, { conversations, messages });
  return { conversations, messages };
}

export async function memoryStats(ctx: Ctx) {
  const [k, c, m] = await Promise.all([
    ctx.sb.from("knowledge_items").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId),
    ctx.sb.from("chat_conversations").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId),
    ctx.sb.from("chat_conversations").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId).not("digested_at", "is", null),
  ]);
  return { memories: k.count ?? 0, conversations: c.count ?? 0, digested: m.count ?? 0 };
}

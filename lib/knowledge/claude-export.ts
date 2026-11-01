/**
 * Parser for Claude's data export (Settings → Privacy → Export data →
 * conversations.json). Deterministic: keeps the text of each message; drops
 * attachments, tool calls and thinking. Used to build Jarvis's searchable
 * memory of past chats.
 */

export type ParsedMessage = { external_id: string; position: number; sender: "human" | "assistant"; sent_at: string | null; body: string };
export type ParsedConversation = {
  external_id: string;
  title: string;
  started_at: string | null;
  last_message_at: string | null;
  messages: ParsedMessage[];
};

export const MAX_MESSAGE_CHARS = 12_000;

type J = Record<string, unknown>;

function textOf(msg: J): string {
  const blocks = Array.isArray(msg.content) ? (msg.content as J[]) : [];
  const fromBlocks = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => (b.text as string).trim())
    .filter(Boolean)
    .join("\n\n");
  const text = fromBlocks || (typeof msg.text === "string" ? msg.text.trim() : "");
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

function ts(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseClaudeExport(data: unknown): ParsedConversation[] {
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as J).conversations) ? ((data as J).conversations as unknown[]) : null;
  if (!list) throw new Error("This doesn't look like Claude's conversations.json export.");
  const out: ParsedConversation[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as J;
    const id = typeof c.uuid === "string" ? c.uuid : typeof c.id === "string" ? c.id : null;
    if (!id) continue;
    const msgs = Array.isArray(c.chat_messages) ? (c.chat_messages as J[]) : Array.isArray(c.messages) ? (c.messages as J[]) : [];
    const messages: ParsedMessage[] = [];
    msgs.forEach((m, idx) => {
      const sender = m.sender === "human" || m.role === "user" ? "human" : m.sender === "assistant" || m.role === "assistant" ? "assistant" : null;
      if (!sender) return;
      const body = textOf(m);
      if (!body) return;
      messages.push({ external_id: typeof m.uuid === "string" ? m.uuid : `${id}:${idx}`, position: idx, sender, sent_at: ts(m.created_at), body });
    });
    if (!messages.length) continue;
    const times = messages.map((m) => m.sent_at).filter(Boolean) as string[];
    out.push({
      external_id: id,
      title: (typeof c.name === "string" && c.name.trim()) || messages.find((m) => m.sender === "human")?.body.slice(0, 80) || "Untitled chat",
      started_at: ts(c.created_at) ?? times[0] ?? null,
      last_message_at: ts(c.updated_at) ?? times[times.length - 1] ?? null,
      messages,
    });
  }
  return out;
}

/** Split conversations into upload batches under a byte budget. */
export function batchConversations(convs: ParsedConversation[], maxBytes = 2_000_000): ParsedConversation[][] {
  const batches: ParsedConversation[][] = [];
  let cur: ParsedConversation[] = [];
  let size = 0;
  for (const c of convs) {
    const s = JSON.stringify(c).length;
    if (cur.length && size + s > maxBytes) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += s;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

import { createHash } from "node:crypto";

/**
 * Normalises incoming message payloads from Jasper's own devices:
 *  - the Mac bridge (iMessage/SMS from Messages, WhatsApp from WhatsApp Desktop), batched
 *  - an iPhone Shortcuts "Message" automation (one message: sender + text)
 */

export type IncomingMessage = { source: "imessage" | "sms" | "whatsapp" | "other"; external_id: string; chat_name: string | null; sender: string | null; is_group: boolean; sent_at: string; text: string };

const SOURCES = new Set(["imessage", "sms", "whatsapp", "other"]);
export const MAX_MESSAGE_CHARS = 4000;

export function normaliseMessages(body: unknown, now = new Date()): IncomingMessage[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { messages?: unknown }).messages) ? (body as { messages: unknown[] }).messages : [body];
  const out: IncomingMessage[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const text = String(m.text ?? m.body ?? m.message ?? "").trim();
    if (!text) continue;
    const srcRaw = String(m.source ?? "imessage").toLowerCase();
    const source = (SOURCES.has(srcRaw) ? srcRaw : "other") as IncomingMessage["source"];
    const sender = m.sender ?? m.from ? String(m.sender ?? m.from).slice(0, 200) : null;
    const sentRaw = m.sent_at ?? m.date ?? null;
    const t = sentRaw ? Date.parse(String(sentRaw)) : NaN;
    const sent_at = Number.isNaN(t) || t > now.getTime() + 3_600_000 ? now.toISOString() : new Date(t).toISOString();
    // Shortcuts can't supply an id: derive one from sender + text + minute so retries don't duplicate.
    const external_id = m.external_id ? String(m.external_id).slice(0, 200) : createHash("sha256").update(`${source}|${sender}|${text}|${sent_at.slice(0, 16)}`).digest("hex").slice(0, 32);
    out.push({
      source,
      external_id,
      chat_name: m.chat_name ?? m.chat ? String(m.chat_name ?? m.chat).slice(0, 200) : sender,
      sender,
      is_group: Boolean(m.is_group),
      sent_at,
      text: text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text,
    });
  }
  return out.slice(0, 500);
}

/** Group decrypted messages by chat for summarising (newest chats first). */
export function groupByChat<T extends { source: string; chat_name: string | null; sender: string | null; sent_at: string; text: string }>(msgs: T[]) {
  const map = new Map<string, { source: string; chat: string; count: number; last: string; messages: { sender: string | null; sent_at: string; text: string }[] }>();
  for (const m of [...msgs].sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
    const chat = m.chat_name ?? m.sender ?? "Unknown";
    const key = `${m.source}|${chat}`;
    const g = map.get(key) ?? { source: m.source, chat, count: 0, last: m.sent_at, messages: [] };
    g.count++;
    g.last = m.sent_at;
    g.messages.push({ sender: m.sender, sent_at: m.sent_at, text: m.text });
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

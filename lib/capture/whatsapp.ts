/**
 * Parses a WhatsApp "Export chat" text file (iPhone or Android format, UK
 * dates) into messages. This uses WhatsApp's own official export feature —
 * share a chat to Jarvis from your phone and Claude can summarise it.
 *
 * iPhone:  [02/11/2026, 07:30:12] Dan Smith: Game moved to 7pm
 * Android: 02/11/2026, 07:30 - Dan Smith: Game moved to 7pm
 */

export type WaMessage = { sender: string; sent_at: string; text: string };

const IOS = /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\]\s+([^:]+?):\s([\s\S]*)$/i;
const ANDROID = /^‎?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s+[-–]\s+([^:]+?):\s([\s\S]*)$/i;
const MEDIA = /^‎?(?:<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted|Contact card omitted)/i;

/** UK local wall-clock time → UTC ISO string (handles GMT/BST). */
export function londonToIso(y: number, mo: number, d: number, h: number, mi: number, s = 0): string {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLondon = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asLondon - guess)).toISOString();
}

function toIso(m: RegExpExecArray): string {
  const d = Number(m[1]), mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  let h = Number(m[4]);
  const ap = m[7]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return londonToIso(y, mo, d, h, Number(m[5]), Number(m[6] ?? 0));
}

export function looksLikeWhatsApp(text: string): boolean {
  const lines = text.split(/\r?\n/).slice(0, 40);
  return lines.filter((l) => IOS.test(l.trim()) || ANDROID.test(l.trim())).length >= 2;
}

export function parseWhatsAppExport(text: string, opts: { myName?: string | null; since?: string | null } = {}) {
  const messages: WaMessage[] = [];
  let current: WaMessage | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/^﻿/, "");
    const m = IOS.exec(line) ?? ANDROID.exec(line);
    if (m) {
      if (current) messages.push(current);
      const body = m[9].trim();
      current = { sender: m[8].replace(/‎/g, "").trim(), sent_at: toIso(m), text: MEDIA.test(body) ? "[media]" : body.replace(/‎/g, "") };
    } else if (current && line.trim()) {
      current.text += `\n${line.replace(/‎/g, "")}`;
    }
  }
  if (current) messages.push(current);

  const senders = [...new Set(messages.map((m) => m.sender))];
  const me = opts.myName?.trim().toLowerCase();
  const isMe = (s: string) => Boolean(me && (s.toLowerCase() === me || s.toLowerCase().startsWith(`${me} `)));
  const others = senders.filter((s) => !isMe(s));
  const filtered = messages.filter((m) => !isMe(m.sender) && m.text !== "[media]" && (!opts.since || m.sent_at >= opts.since) && !/end-to-end encrypted|created group|added you|changed the subject/i.test(m.text));
  return { messages: filtered, total: messages.length, participants: senders, isGroup: others.length > 1 };
}

/** "WhatsApp Chat - 5-a-side.zip" / "WhatsApp Chat with Mum.txt" → "5-a-side" / "Mum". */
export function chatNameFromFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /WhatsApp Chat(?: with| -)?\s*(.+?)(?:\.(?:zip|txt))?$/i.exec(name.trim());
  return m?.[1]?.trim() || null;
}

import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { classifyCapture } from "@/lib/capture/classify";
import { chatNameFromFilename, parseWhatsAppExport } from "@/lib/capture/whatsapp";
import { extractBearer } from "@/lib/mcp/auth";
import { supabaseAnon } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * "Send to Jarvis" — the iPhone share sheet target. Accepts:
 *  - multipart form (field "content": a file or text) — recommended Shortcut setup
 *  - JSON { text | url, title }
 *  - a raw file body (WhatsApp export .zip or .txt) with ?name=<filename>
 * WhatsApp chat exports become messages (summarise with "what did I miss in …?");
 * everything else becomes a note or link in the Jarvis Inbox.
 * Responds with { message } so the Shortcut can show a notification.
 */

const MAX_BYTES = 5_000_000;

function textFromBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes, { filter: (f) => /\.txt$/i.test(f.name) });
    const entry = Object.entries(files).sort(([a], [b]) => Number(/_chat\.txt$/i.test(b)) - Number(/_chat\.txt$/i.test(a)))[0];
    if (!entry) throw new Error("No chat text inside that zip.");
    return strFromU8(entry[1]);
  }
  return new TextDecoder().decode(bytes);
}

async function readInput(request: Request): Promise<{ text: string; name: string | null; url: string | null }> {
  const params = new URL(request.url).searchParams;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const fd = await request.formData();
    const name = (fd.get("title") as string | null) ?? null;
    for (const [, v] of fd.entries()) {
      if (typeof v === "string" && v.trim()) return { text: v, name: name ?? params.get("name"), url: null };
      if (v instanceof File && v.size) {
        if (v.size > MAX_BYTES) throw new Error("That file is too large (5 MB max).");
        return { text: textFromBytes(new Uint8Array(await v.arrayBuffer())), name: name ?? v.name ?? params.get("name"), url: null };
      }
    }
    return { text: "", name, url: null };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("That's too large (5 MB max).");
  if (type.includes("application/json")) {
    const j = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const text = String(j.text ?? j.content ?? j.url ?? "");
    return { text, name: (j.title as string) ?? (j.name as string) ?? params.get("name"), url: (j.url as string) ?? null };
  }
  return { text: textFromBytes(bytes), name: params.get("name"), url: null };
}

export async function POST(request: Request) {
  const token = extractBearer(request.headers.get("authorization"));
  if (!token) return Response.json({ message: "Missing device token." }, { status: 401 });
  let input;
  try {
    input = await readInput(request);
  } catch (e) {
    return Response.json({ message: e instanceof Error ? e.message : "Couldn't read that." }, { status: 400 });
  }
  if (!input.text.trim()) return Response.json({ message: "Nothing to save." }, { status: 400 });

  const key = env.vaultKey();
  const sb = supabaseAnon();
  const params = new URL(request.url).searchParams;
  const chatName = chatNameFromFilename(input.name) ?? input.name;
  const c = classifyCapture(input.text, chatName);

  if (c.kind === "whatsapp") {
    const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 90);
    const parsed = parseWhatsAppExport(input.text, { myName: params.get("me") ?? "Jasper", since: new Date(Date.now() - days * 86_400_000).toISOString() });
    const chat = chatName ?? (parsed.isGroup ? "WhatsApp group" : parsed.messages[0]?.sender ?? "WhatsApp chat");
    const rows = parsed.messages.slice(-500).map((m) => ({
      source: "whatsapp",
      external_id: `wa-export:${createHash("sha256").update(`${chat}|${m.sender}|${m.sent_at}|${m.text}`).digest("hex").slice(0, 32)}`,
      chat_name: chat,
      sender: m.sender,
      is_group: parsed.isGroup,
      sent_at: m.sent_at,
      body_enc: encrypt(m.text, key),
    }));
    if (rows.length) {
      const { error } = await sb.rpc("jarvis_ingest", { p_token: token, p_kind: "messages", p_rows: rows, p_retention_days: Number(params.get("retention_days")) || 14 });
      if (error) return Response.json({ message: /Invalid or revoked/.test(error.message) ? "This token can't send messages — tick “messages” on the device token." : "Couldn't save the chat." }, { status: 401 });
    }
    const { error } = await sb.rpc("jarvis_capture", { p_token: token, p_kind: "whatsapp", p_title: chat, p_url: null, p_body_enc: null, p_meta: { messages: rows.length, participants: parsed.participants.length, days } });
    if (error) return Response.json({ message: "Saved the messages, but this token can't create Inbox items (tick “capture”)." }, { status: 207 });
    return Response.json({ message: rows.length ? `Jarvis has ${rows.length} message${rows.length === 1 ? "" : "s"} from “${chat}” (last ${days} days). Ask: “what did I miss in ${chat}?”` : `No new messages from others in “${chat}” in the last ${days} days.`, kind: "whatsapp", messages: rows.length });
  }

  const { error } = await sb.rpc("jarvis_capture", { p_token: token, p_kind: c.kind, p_title: c.title, p_url: c.url ?? input.url, p_body_enc: encrypt(input.text.slice(0, 20_000), key), p_meta: { chars: input.text.length } });
  if (error) return Response.json({ message: /Invalid or revoked/.test(error.message) ? "Invalid device token, or it doesn't have the “capture” permission." : "Couldn't save that." }, { status: 401 });
  return Response.json({ message: c.kind === "link" ? `Saved link: ${c.title}` : `Saved to your Jarvis Inbox: ${c.title}`, kind: c.kind });
}

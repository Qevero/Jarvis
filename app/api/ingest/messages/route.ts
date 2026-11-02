import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ingest, readJson } from "@/lib/ingest";
import { normaliseMessages } from "@/lib/messages/normalise";

export const dynamic = "force-dynamic";

/**
 * Incoming messages from Jasper's own devices (Mac bridge for iMessage/SMS/
 * WhatsApp; iPhone Shortcut automation for iMessage). Bodies are encrypted
 * before storage and deleted after the retention period.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const key = env.vaultKey();
  const rows = normaliseMessages(body).map(({ text, ...m }) => ({ ...m, body_enc: encrypt(text, key) }));
  const retention = Number(new URL(request.url).searchParams.get("retention_days")) || 14;
  // Optional: messages the device says were read on the phone/Mac since last time.
  const read = body && typeof body === "object" && Array.isArray((body as { read?: unknown }).read)
    ? ((body as { read: { source?: string; external_id?: string }[] }).read).filter((r) => r?.source && r?.external_id).slice(0, 1000).map((r) => ({ source: String(r.source), external_id: String(r.external_id) }))
    : [];
  if (read.length) {
    const res = await ingest(request, "messages_read", read);
    if (res.status === 401) return res;
  }
  return ingest(request, "messages", rows, retention);
}

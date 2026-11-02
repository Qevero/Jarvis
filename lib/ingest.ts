import { supabaseAnon } from "@/lib/supabase/server";
import { extractBearer } from "@/lib/mcp/auth";

/**
 * Device ingest: iPhone Shortcuts and the Mac bridge POST here with a device
 * token (Settings → Personal → Device tokens). The token is checked, scoped and
 * the rows written by the SQL function public.jarvis_ingest — no secret key needed.
 */
export async function ingest(request: Request, kind: "health" | "workouts" | "messages" | "messages_read", rows: unknown[], retentionDays = 14) {
  const token = extractBearer(request.headers.get("authorization"));
  if (!token) return Response.json({ error: "Missing device token (Authorization: Bearer jv_…)" }, { status: 401 });
  if (!rows.length) return Response.json({ kind, accepted: 0, note: "Nothing recognised in that payload." }, { status: 200 });
  const { data, error } = await supabaseAnon().rpc("jarvis_ingest", { p_token: token, p_kind: kind, p_rows: rows, p_retention_days: retentionDays });
  if (error) {
    const auth = /Invalid or revoked/i.test(error.message);
    return Response.json({ error: auth ? "Invalid, revoked or wrong-permission device token." : "Couldn't save that data." }, { status: auth ? 401 : 400 });
  }
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2_000_000) throw new Error("Payload too large");
  try {
    return JSON.parse(text);
  } catch {
    // Shortcuts sometimes send form-encoded "Dictionary" bodies.
    return Object.fromEntries(new URLSearchParams(text));
  }
}

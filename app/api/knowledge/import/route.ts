import { NextResponse } from "next/server";
import { ownerCheck } from "@/lib/auth";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/oauth";
import { supabaseServer } from "@/lib/supabase/server";
import { parseClaudeExport } from "@/lib/knowledge/claude-export";
import { importConversations } from "@/lib/services/knowledge";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** Receives batches of parsed conversations from the browser (the export is parsed client-side). */
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), env.siteUrl())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const check = ownerCheck(data?.claims as never, env.ownerEmail());
  if (!check.ok) return NextResponse.json({ error: "Sign in with MFA first." }, { status: 401 });
  const body = await request.json().catch(() => null);
  let convs;
  try {
    // Re-validate on the server: never trust the client's parse.
    convs = parseClaudeExport(body?.conversations ?? []);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid data" }, { status: 400 });
  }
  if (convs.length > 200) return NextResponse.json({ error: "Batch too large" }, { status: 413 });
  try {
    const result = await importConversations({ sb, ownerId: check.owner.id, actor: { source: "dashboard" } }, convs);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 500 });
  }
}

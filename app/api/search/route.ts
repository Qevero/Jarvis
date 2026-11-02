import { NextResponse } from "next/server";
import { ownerCheck } from "@/lib/auth";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { searchEverything } from "@/lib/services/labs";

export const dynamic = "force-dynamic";

/** Command palette search (signed-in owner with MFA only). */
export async function GET(request: Request) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const check = ownerCheck(data?.claims as never, env.ownerEmail());
  if (!check.ok) return NextResponse.json({ results: [] }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ results: await searchEverything({ sb, ownerId: check.owner.id, actor: { source: "dashboard" } }, q.slice(0, 100)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/oauth";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), env.siteUrl())) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", env.siteUrl()), 303);
}

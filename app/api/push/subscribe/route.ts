import { NextResponse } from "next/server";
import { z } from "zod";
import { ownerCheck } from "@/lib/auth";
import { audit, type Ctx } from "@/lib/ctx";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/oauth";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Body = z.object({ endpoint: z.string().url().startsWith("https://"), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(8) }) });

async function ctxOrNull(request: Request): Promise<Ctx | null> {
  if (!isSameOrigin(request.headers.get("origin"), env.siteUrl())) return null;
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const check = ownerCheck(data?.claims as never, env.ownerEmail());
  return check.ok ? { sb, ownerId: check.owner.id, actor: { source: "dashboard" } } : null;
}

export async function POST(request: Request) {
  const ctx = await ctxOrNull(request);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  const { error } = await ctx.sb.from("push_subscriptions").upsert({ owner_id: ctx.ownerId, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  await audit(ctx, "push.subscribe", new URL(endpoint).host);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const ctx = await ctxOrNull(request);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (body.endpoint) await ctx.sb.from("push_subscriptions").delete().eq("owner_id", ctx.ownerId).eq("endpoint", body.endpoint);
  return NextResponse.json({ ok: true });
}

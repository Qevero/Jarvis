import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runTick } from "@/lib/cron/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request) {
  const secret = env.cronSecret();
  const got = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

export async function POST(request: Request) {
  if (!authorised(request)) return new Response("Forbidden", { status: 403 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  return Response.json(await runTick({ force }), { headers: { "Cache-Control": "no-store" } });
}

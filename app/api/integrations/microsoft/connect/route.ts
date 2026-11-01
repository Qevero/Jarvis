import { NextResponse } from "next/server";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { env } from "@/lib/env";
import { setOAuthCookie } from "@/lib/integrations/oauth-cookie";
import { pkcePair, randomToken } from "@/lib/integrations/pkce";
import { msAuthorizeUrl } from "@/lib/ms/graph";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await dashboardCtx("/settings");
  if (!env.microsoft()) return NextResponse.redirect(new URL("/settings?microsoft=not_configured", env.siteUrl()));
  const state = randomToken();
  const { verifier, challenge } = pkcePair();
  await setOAuthCookie("microsoft", { state, verifier, ownerId: ctx.ownerId });
  return NextResponse.redirect(msAuthorizeUrl(state, challenge));
}

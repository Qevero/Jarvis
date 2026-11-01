import { NextResponse } from "next/server";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { setOAuthCookie } from "@/lib/integrations/oauth-cookie";
import { pkcePair, randomToken } from "@/lib/integrations/pkce";
import { xeroAuthorizeUrl } from "@/lib/xero/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await dashboardCtx("/settings");
  if (!env.xero()) return NextResponse.redirect(new URL("/settings?xero=not_configured", env.siteUrl()));
  const state = randomToken();
  const { verifier, challenge } = pkcePair();
  await setOAuthCookie("xero", { state, verifier, ownerId: ctx.ownerId });
  return NextResponse.redirect(xeroAuthorizeUrl(state, challenge));
}

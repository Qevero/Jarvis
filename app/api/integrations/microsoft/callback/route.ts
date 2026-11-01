import { NextResponse } from "next/server";
import { audit } from "@/lib/ctx";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { env } from "@/lib/env";
import { saveTokens } from "@/lib/integrations/connections";
import { takeOAuthCookie } from "@/lib/integrations/oauth-cookie";
import { exchangeMsCode, GraphClient } from "@/lib/ms/graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?microsoft=${q}`, env.siteUrl()));
  const ctx = await dashboardCtx("/settings");
  const url = new URL(request.url);
  const saved = await takeOAuthCookie("microsoft");
  if (url.searchParams.get("error")) return back("denied");
  if (!saved || saved.state !== url.searchParams.get("state") || saved.ownerId !== ctx.ownerId) return back("state_mismatch");
  const code = url.searchParams.get("code");
  if (!code) return back("no_code");
  try {
    const t = await exchangeMsCode(code, saved.verifier);
    await saveTokens(ctx, "microsoft", { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, scopes: t.scope ?? null });
    const me = await new GraphClient(ctx).me().catch(() => null);
    const label = me?.mail ?? me?.userPrincipalName ?? null;
    await saveTokens(ctx, "microsoft", { accessToken: t.access_token, expiresIn: t.expires_in, accountLabel: label });
    await audit(ctx, "microsoft.connect", label);
    return back("connected");
  } catch {
    return back("failed");
  }
}

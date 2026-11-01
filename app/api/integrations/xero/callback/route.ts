import { NextResponse } from "next/server";
import { audit } from "@/lib/ctx";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { env } from "@/lib/env";
import { saveTokens } from "@/lib/integrations/connections";
import { takeOAuthCookie } from "@/lib/integrations/oauth-cookie";
import { exchangeXeroCode, xeroTenants } from "@/lib/xero/client";
import { syncXero } from "@/lib/xero/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?xero=${q}`, env.siteUrl()));
  const ctx = await dashboardCtx("/settings");
  const url = new URL(request.url);
  const saved = await takeOAuthCookie("xero");
  if (url.searchParams.get("error")) return back("denied");
  if (!saved || saved.state !== url.searchParams.get("state") || saved.ownerId !== ctx.ownerId) return back("state_mismatch");
  const code = url.searchParams.get("code");
  if (!code) return back("no_code");

  try {
    const t = await exchangeXeroCode(code, saved.verifier);
    const tenants = (await xeroTenants(t.access_token)).filter((x) => x.tenantType === "ORGANISATION");
    if (!tenants.length) return back("no_organisation");
    const tenant = tenants.find((x) => /qevero/i.test(x.tenantName)) ?? tenants[0];
    await saveTokens(ctx, "xero", { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, scopes: t.scope ?? null, tenantId: tenant.tenantId, tenantName: tenant.tenantName, accountLabel: tenant.tenantName });
    await audit(ctx, "xero.connect", tenant.tenantId, { organisation: tenant.tenantName });
    await syncXero(ctx, { budgetMs: 30_000 }).catch(() => null);
    return back("connected");
  } catch {
    return back("failed");
  }
}

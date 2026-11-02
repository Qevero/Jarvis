import { NextResponse } from "next/server";
import { ownerCheck } from "@/lib/auth";
import { env } from "@/lib/env";
import { isAllowedRedirect, isSameOrigin } from "@/lib/oauth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseVaultStore } from "@/lib/vault/store";

export const dynamic = "force-dynamic";

function errorPage(message: string, status = 400) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Jarvis</title><body style="background:#070b11;color:#e6f1ff;font-family:system-ui;padding:24px"><p>${message}</p><p><a style="color:#38e1ff" href="/">Back to Jarvis</a></p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), env.siteUrl())) return errorPage("Request blocked (cross-site).", 403);

  const form = await request.formData();
  const authorizationId = String(form.get("authorization_id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!authorizationId) return errorPage("Missing authorisation request.");

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const check = ownerCheck(data?.claims as never, env.ownerEmail());
  if (!check.ok) return errorPage("Please sign in to Jarvis with MFA, then try again from Claude.", 401);

  const store = supabaseVaultStore(supabase);

  if (decision === "approve") {
    // Re-check the redirect target server-side before approving.
    const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !details) return errorPage("This authorisation request is invalid or has expired.");
    if ("authorization_id" in details) {
      if (!isAllowedRedirect(details.redirect_uri, env.allowedRedirectUris())) return errorPage("This app's return address isn't on the allowlist.", 403);
    }
    const { data: approved, error: approveError } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (approveError || !approved) return errorPage("Approval failed. Start again from Claude.");
    await store.appendAudit({
      source: "dashboard",
      action: "oauth.approve_connector",
      target: "client" in details ? details.client.name : null,
      details: "client" in details ? { client_id: details.client.id, redirect_uri: details.redirect_uri } : {},
    });
    // 303 so the browser follows with GET.
    return NextResponse.redirect(approved.redirect_url, 303);
  }

  const { data: denied, error: denyError } = await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (denyError || !denied) return errorPage("Request cancelled.");
  await store.appendAudit({ source: "dashboard", action: "oauth.deny_connector", target: authorizationId });
  return NextResponse.redirect(denied.redirect_url, 303);
}

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { isAllowedRedirect } from "@/lib/oauth";
import { HudMark } from "@/components/hud-mark";

export const dynamic = "force-dynamic";

/**
 * Consent screen for Supabase Auth's OAuth 2.1 server. Claude lands here when
 * Jasper adds or reconnects the Jarvis connector.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!authorizationId) return <Shell><p className="text-danger">Missing authorisation request.</p></Shell>;

  const { supabase } = await requireOwner(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !details) {
    return <Shell><p className="text-danger">This authorisation request is invalid or has expired. Start again from Claude.</p></Shell>;
  }
  // Already approved earlier: Supabase returns the redirect straight away.
  if (!("authorization_id" in details)) redirect(details.redirect_url);

  const allowed = isAllowedRedirect(details.redirect_uri, env.allowedRedirectUris());

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-wide">Connect {details.client.name || "this app"} to Jarvis?</h1>
      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="hud-label">Application</dt>
          <dd>{details.client.name || "Unnamed client"}</dd>
        </div>
        <div>
          <dt className="hud-label">Returns to</dt>
          <dd className="break-all font-mono text-xs">{details.redirect_uri}</dd>
        </div>
        <div>
          <dt className="hud-label">Access</dt>
          <dd>Read and update Qevero&apos;s Company Vault and future Jarvis modules as you, under the audit log.</dd>
        </div>
      </dl>

      {!allowed && (
        <p className="mt-5 rounded-md border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
          Blocked: this app&apos;s return address isn&apos;t on Jarvis&apos;s allowlist. Only the Claude connector can be approved. If this is Claude and the address has changed, add it to OAUTH_ALLOWED_REDIRECT_URIS.
        </p>
      )}

      <form action="/api/oauth/decision" method="POST" className="mt-6 grid grid-cols-2 gap-3">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <button type="submit" name="decision" value="deny" className="btn btn-ghost">
          Deny
        </button>
        <button type="submit" name="decision" value="approve" className="btn btn-primary" disabled={!allowed}>
          Approve
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <HudMark className="h-10 w-10" />
        <span className="hud-label">Jarvis · connector authorisation</span>
      </div>
      <section className="panel p-5">{children}</section>
    </main>
  );
}

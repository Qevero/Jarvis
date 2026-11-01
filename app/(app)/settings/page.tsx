import { formatUkDateTime } from "@/lib/dates";
import { mcpResourceUrl } from "@/lib/env";
import { dashboardVault } from "@/lib/vault/dashboard";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { store, owner } = await dashboardVault("/settings");
  const audit = await store.listAudit(50);
  const connectorUrl = mcpResourceUrl();

  return (
    <div className="space-y-5">
      <div>
        <p className="hud-label">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold">Connector, data and security</h1>
      </div>

      <section className="panel p-5">
        <h2 className="hud-label">Claude connector</h2>
        <p className="mt-2 text-sm text-muted">In Claude (web or desktop): Settings → Connectors → Add custom connector. Name it &ldquo;Jarvis&rdquo; and paste this URL. It then appears in the Claude iPhone app too.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="input flex items-center overflow-x-auto whitespace-nowrap font-mono text-sm">{connectorUrl}</code>
          <CopyButton value={connectorUrl} />
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="hud-label">Your data</h2>
        <p className="mt-2 text-sm text-muted">Download everything Jarvis stores about Qevero as JSON (UK GDPR export). Sensitive fields are included decrypted, so keep the file safe.</p>
        <a href="/api/export" className="btn btn-ghost mt-3">Export all data</a>
      </section>

      <section className="panel p-5">
        <h2 className="hud-label">Signed in</h2>
        <p className="mt-2 text-sm">{owner.email} · MFA verified</p>
        <form action="/auth/signout" method="POST" className="mt-3">
          <button className="btn btn-ghost">Sign out</button>
        </form>
      </section>

      <section className="panel p-5">
        <h2 className="hud-label">Audit log · latest 50</h2>
        {audit.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {audit.map((a) => (
              <li key={a.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[10rem_6rem_1fr]">
                <span className="font-mono text-xs text-muted">{formatUkDateTime(a.occurred_at)}</span>
                <span>
                  <span className={`badge ${a.source === "mcp" ? "border-accent text-accent" : ""}`}>{a.source === "mcp" ? "Claude" : a.source}</span>
                </span>
                <span className="break-words">
                  {a.action}
                  {a.target && <span className="text-muted"> · {a.target}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

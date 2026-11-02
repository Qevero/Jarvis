import { formatUkDateTime } from "@/lib/dates";
import { env, mcpResourceUrl } from "@/lib/env";
import { getPrefs } from "@/lib/ctx";
import { crmConfigured } from "@/lib/crm/client";
import { connectionStatus } from "@/lib/integrations/connections";
import { lastSync, trackingCategoryExists } from "@/lib/xero/sync";
import { dashboardVault } from "@/lib/vault/dashboard";
import { CopyButton } from "@/components/copy-button";
import { ActionForm, InlineAction } from "@/components/forms";
import { PushToggle } from "@/components/push-toggle";
import { Panel, Tabs } from "@/components/ui";
import { connectHevyAction, createIngestTokenAction, disconnectAction, revokeIngestTokenAction, savePersonalPrefsAction, savePrefsAction, setupTrackingAction, syncXeroAction, testPushAction } from "../actions";
import { listIngestTokens } from "@/lib/services/personal";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  connected: "Connected ✓",
  denied: "You cancelled the connection.",
  state_mismatch: "The sign-in expired. Try again.",
  failed: "Connection failed. Check the client ID/secret and redirect URI.",
  not_configured: "Add the app's client ID and secret to Netlify first (see README).",
  no_organisation: "No Xero organisation was authorised.",
};

function Status({ status }: { status: string | undefined }) {
  if (status === "active") return <span className="badge border-ok/50 text-ok">● Connected</span>;
  if (status === "needs_reconnect") return <span className="badge border-warn/60 text-warn">● Reconnect needed</span>;
  return <span className="badge">○ Not connected</span>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ xero?: string; microsoft?: string; tab?: string }> }) {
  const sp = await searchParams;
  const { store, owner, supabase } = await dashboardVault("/settings");
  const ctx = { sb: supabase, ownerId: owner.id, actor: { source: "dashboard" as const } };
  const [audit, xero, ms, sync, prefs, tracking, usage] = await Promise.all([
    store.listAudit(60),
    connectionStatus(ctx, "xero"),
    connectionStatus(ctx, "microsoft"),
    lastSync(ctx),
    getPrefs(ctx),
    trackingCategoryExists(ctx),
    supabase.from("xero_api_usage").select("day, calls").eq("owner_id", owner.id).order("day", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const [tokens, { data: hevy }] = await Promise.all([listIngestTokens(ctx), supabase.from("integration_connections").select("status, connected_at").eq("owner_id", owner.id).eq("provider", "hevy").maybeSingle()]);
  const site = env.siteUrl();
  const TABS = [{ id: "connections", label: "Connections" }, { id: "personal", label: "Personal" }, { id: "devices", label: "Devices" }, { id: "preferences", label: "Preferences" }, { id: "data", label: "Data & security" }];
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : sp.xero || sp.microsoft ? "connections" : "connections";
  const connectorUrl = mcpResourceUrl();
  const num = (name: keyof typeof prefs, label: string, hint?: string) => (
    <label><span className="hud-label">{label}</span><input name={name} type="number" defaultValue={String(prefs[name])} className="input" />{hint && <span className="text-xs text-muted">{hint}</span>}</label>
  );

  return (
    <div className="space-y-5 fade-in">
      <div>
        <p className="hud-label">Settings</p>
        <h1 className="mt-1.5 text-[1.7rem] font-semibold tracking-tight">Settings</h1>
      </div>
      <Tabs active={tab} tabs={TABS.map((t) => ({ ...t, href: `/settings?tab=${t.id}` }))} />

      {tab === "connections" && (<>
      <Panel title="Claude connector">
        <p className="text-sm text-muted">In Claude (web or desktop): Settings → Connectors → Add custom connector. Name it “Jarvis” and paste this URL. It then works in the Claude iPhone app too.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="input flex items-center overflow-x-auto whitespace-nowrap font-mono text-sm">{connectorUrl}</code>
          <CopyButton value={connectorUrl} />
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Xero" action={<Status status={xero?.status} />}>
          {sp.xero && <p className="mb-2 text-sm text-accent">{NOTICES[sp.xero] ?? sp.xero}</p>}
          {xero?.status === "active" ? (
            <div className="space-y-3 text-sm">
              <p>{xero.tenant_name} · connected {formatUkDateTime(xero.connected_at)}</p>
              <p className="text-muted">Last sync {sync?.last_success_at ? formatUkDateTime(sync.last_success_at) : "never"}{sync?.last_error ? ` · last error: ${sync.last_error}` : ""} · API calls today: {usage.data?.calls ?? 0}/{prefs.xeroDailyCallBudget}</p>
              <ActionForm action={syncXeroAction} submit="Sync now"><span /></ActionForm>
              {!tracking && <ActionForm action={setupTrackingAction} submit="Create “Revenue Stream” tracking category"><p className="text-muted">Needed to tag invoice lines by stream.</p></ActionForm>}
              <InlineAction action={disconnectAction} fields={{ provider: "xero" }} label="Disconnect" className="btn btn-ghost btn-sm text-danger" />
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted">Invoices, bills, contacts and bank data for revenue analytics, VAT and drafting invoices/quotes/POs.</p>
              {env.xero() ? <a href="/api/integrations/xero/connect" className="btn btn-primary btn-sm">{xero?.status === "needs_reconnect" ? "Reconnect Xero" : "Connect Xero"}</a> : <p className="text-warn">Add XERO_CLIENT_ID and XERO_CLIENT_SECRET in Netlify first (README → Xero).</p>}
            </div>
          )}
        </Panel>

        <Panel title="Microsoft (Outlook, Calendar, To Do)" action={<Status status={ms?.status} />}>
          {sp.microsoft && <p className="mb-2 text-sm text-accent">{NOTICES[sp.microsoft] ?? sp.microsoft}</p>}
          {ms?.status === "active" ? (
            <div className="space-y-3 text-sm">
              <p>{ms.account_label ?? "Connected"} · since {formatUkDateTime(ms.connected_at)}</p>
              <p className="text-muted">Permissions: tasks, calendar, read mail and create drafts. Jarvis has no permission to send email.</p>
              <InlineAction action={disconnectAction} fields={{ provider: "microsoft" }} label="Disconnect" className="btn btn-ghost btn-sm text-danger" />
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted">Connect qevero@outlook.com for To Do tasks, calendar, inbox summaries and email drafts.</p>
              {env.microsoft() ? <a href="/api/integrations/microsoft/connect" className="btn btn-primary btn-sm">{ms?.status === "needs_reconnect" ? "Reconnect Microsoft" : "Connect Microsoft"}</a> : <p className="text-warn">Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in Netlify first (README → Microsoft).</p>}
            </div>
          )}
        </Panel>

        <Panel title="Qevero CRM" action={crmConfigured() ? <span className="badge border-ok/50 text-ok">● Configured</span> : <span className="badge">○ Not configured</span>}>
          <p className="text-sm text-muted">Read-only: leads, pipeline, CRM tasks and tenders. Set up with one SQL script in the CRM&apos;s Supabase and three Netlify variables (README → Qevero CRM connector).</p>
        </Panel>

        <Panel title="Companies House" action={env.companiesHouseKey() ? <span className="badge border-ok/50 text-ok">● Configured</span> : <span className="badge">○ Optional</span>}>
          <p className="text-sm text-muted">Free API key to cross-check filing deadlines and officers (COMPANIES_HOUSE_API_KEY).</p>
        </Panel>
      </div>

      <section id="notifications" className="scroll-mt-6">
      <Panel title="Notifications">
        <p className="mb-3 text-sm text-muted">Morning briefing at {String(prefs.briefingHour).padStart(2, "0")}:00, the Sunday weekly review, and deadline reminders {prefs.reminderLeadDays.join("/")} days before. On iPhone, open Jarvis from the Home Screen icon, then enable here.</p>
        <PushToggle publicKey={env.vapid()?.publicKey ?? null} />
        <ActionForm action={testPushAction} submit="Send a test notification" className="mt-3"><span /></ActionForm>
      </Panel>
      </section>
      </>)}

      {tab === "personal" && (
      <section id="personal" className="space-y-5 scroll-mt-6">
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Home, goals and privacy">
            <ActionForm action={savePersonalPrefsAction} submit="Save">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="hud-label">Home (for weather)</span><input name="homeLocationName" defaultValue={prefs.homeLocationName} className="input" /></label>
                <label><span className="hud-label">Calorie target (kcal)</span><input name="calorieTarget" type="number" defaultValue={prefs.calorieTarget || ""} className="input" /></label>
                <label><span className="hud-label">Protein target (g)</span><input name="proteinTarget" type="number" defaultValue={prefs.proteinTarget || ""} className="input" /></label>
                <label><span className="hud-label">Target weight (kg)</span><input name="targetWeightKg" type="number" step="0.1" defaultValue={prefs.targetWeightKg || ""} className="input" /></label>
                <label><span className="hud-label">Workouts per week</span><input name="workoutsPerWeek" type="number" defaultValue={prefs.workoutsPerWeek || ""} className="input" /></label>
                <label className="sm:col-span-2"><span className="hud-label">Keep forwarded messages for (days)</span><input name="messageRetentionDays" type="number" min={1} max={90} defaultValue={prefs.messageRetentionDays} className="input" /></label>
              </div>
            </ActionForm>
          </Panel>
          <Panel title="Hevy (lifts and sessions)" action={hevy?.status === "active" ? <span className="badge border-ok/50 text-ok">● Connected</span> : <span className="badge">○ Not connected</span>}>
            <p className="mb-2 text-sm text-muted">Hevy&apos;s API needs Hevy Pro. Get your key in Hevy → Settings → Developer (or hevy.com/settings?developer). Without Pro, workouts still arrive via Apple Health (no sets/weights).</p>
            <ActionForm action={connectHevyAction} submit={hevy?.status === "active" ? "Replace key" : "Connect Hevy"}>
              <input name="api_key" type="password" autoComplete="off" placeholder="Hevy API key" className="input" />
            </ActionForm>
          </Panel>
        </div>
      </section>
      )}

      {tab === "devices" && (
      <section className="space-y-5">
        <Panel title="Device tokens (iPhone Shortcuts, Mac bridge)">
          <p className="mb-3 text-sm text-muted">Your iPhone and Mac send health data and messages to Jarvis with a device token. Create one per device, with only the permissions it needs. Revoke any time.</p>
          <dl className="mb-4 grid gap-1 text-xs sm:grid-cols-[9rem_1fr]">
            <dt className="text-muted">Health URL</dt><dd className="break-all font-mono">{site}/api/ingest/health</dd>
            <dt className="text-muted">Workouts URL</dt><dd className="break-all font-mono">{site}/api/ingest/workouts</dd>
            <dt className="text-muted">Messages URL</dt><dd className="break-all font-mono">{site}/api/ingest/messages?retention_days={prefs.messageRetentionDays}</dd>
            <dt className="text-muted">Send to Jarvis URL</dt><dd className="break-all font-mono">{site}/api/ingest/capture</dd>
          </dl>
          <ActionForm action={createIngestTokenAction} submit="Create token">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input name="name" placeholder="Device name, e.g. iPhone" required className="input sm:max-w-xs" />
              {["health", "workouts", "capture", "messages"].map((sc) => <label key={sc} className="flex items-center gap-2 text-sm"><input type="checkbox" name="scopes" value={sc} defaultChecked className="h-5 w-5" /> {sc}</label>)}
            </div>
          </ActionForm>
          {tokens.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{t.name} <span className="text-xs text-muted">· {t.scopes.join(", ")} · {t.revoked_at ? "revoked" : t.last_used_at ? `last used ${formatUkDateTime(t.last_used_at)}` : "not used yet"}</span></span>
                  {!t.revoked_at && <InlineAction action={revokeIngestTokenAction} fields={{ id: t.id }} label="Revoke" className="btn btn-ghost btn-sm text-danger" />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
      )}

      {tab === "preferences" && (
      <Panel title="Preferences & thresholds">
        <ActionForm action={savePrefsAction} submit="Save preferences">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {num("streamDropPct", "Stream drop flag (%)", "vs trailing 3-month average")}
            {num("streamDropMinAverage", "Ignore streams below (£/mo)")}
            {num("overdueDays", "Overdue after (days)")}
            {num("staleDraftDays", "Stale draft after (days)")}
            {num("concentrationTop1Pct", "Top client limit (%)")}
            {num("concentrationTop3Pct", "Top 3 clients limit (%)")}
            {num("retainerGraceDay", "Retainer invoiced by day")}
            {num("proposalFollowUpDays", "Proposal follow-up (days)")}
            {num("briefingHour", "Briefing hour (UK)")}
            <label><span className="hud-label">Reminder days before</span><input name="reminderLeadDays" defaultValue={prefs.reminderLeadDays.join(", ")} className="input" /></label>
            {num("paymentTermsDays", "Payment terms (days)")}
            {num("associatedCompanies", "Associated companies (CT)")}
            <label><span className="hud-label">Default sales account</span><input name="defaultSalesAccount" defaultValue={prefs.defaultSalesAccount} className="input" /></label>
            <label><span className="hud-label">Default purchase account</span><input name="defaultPurchaseAccount" defaultValue={prefs.defaultPurchaseAccount} className="input" /></label>
            {num("xeroSyncHours", "Xero sync every (hours)")}
            {num("xeroDailyCallBudget", "Xero calls per day (max)")}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="deadlineTasks" defaultChecked={prefs.deadlineTasks} className="h-5 w-5" /> Add upcoming deadlines to Microsoft To Do ({Math.max(...prefs.reminderLeadDays)} days before)</label>
        </ActionForm>
      </Panel>
      )}

      {tab === "data" && (<>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Your data">
          <p className="text-sm text-muted">Download everything Jarvis stores as JSON (UK GDPR export). Sensitive fields are included decrypted, so keep the file safe.</p>
          <a href="/api/export" className="btn btn-ghost mt-3">Export all data</a>
        </Panel>
        <Panel title="Signed in">
          <p className="text-sm">{owner.email} · MFA verified</p>
          <form action="/auth/signout" method="POST" className="mt-3"><button className="btn btn-ghost">Sign out</button></form>
        </Panel>
      </div>

      <Panel title="Audit log · latest 60">
        {audit.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
          <ul className="divide-y divide-line">
            {audit.map((a) => (
              <li key={a.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[10rem_6rem_1fr]">
                <span className="font-mono text-xs text-muted">{formatUkDateTime(a.occurred_at)}</span>
                <span><span className={`badge ${a.source === "mcp" ? "border-accent text-accent" : ""}`}>{a.source === "mcp" ? "Claude" : a.source}</span></span>
                <span className="break-words">{a.action}{a.target && <span className="text-muted"> · {a.target}</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      </>)}
    </div>
  );
}

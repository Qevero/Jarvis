import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { env } from "@/lib/env";
import { getPrefs } from "@/lib/ctx";
import { crmConfigured } from "@/lib/crm/client";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const DOCS = "https://github.com/Qevero/Jarvis/blob/main";

type Step = { title: string; why: string; done: boolean; href: string; cta: string; external?: boolean; optional?: boolean };

export default async function SetupPage() {
  const ctx = await dashboardCtx("/setup");
  const count = async (table: string, extra?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    let q = base(table);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  function base(table: string) {
    return ctx.sb.from(table).select("*", { count: "exact", head: true }).eq("owner_id", ctx.ownerId);
  }
  const conn = async (p: string) => (await ctx.sb.from("integration_connections").select("status").eq("owner_id", ctx.ownerId).eq("provider", p).maybeSingle()).data?.status === "active";

  const [mcpUsed, xero, ms, hevy, push, healthDays, captures, msgs, chats, verified, prefs, tokens] = await Promise.all([
    count("audit_log", (q) => q.eq("source", "mcp")),
    conn("xero"),
    conn("microsoft"),
    conn("hevy"),
    count("push_subscriptions"),
    count("health_daily"),
    count("captures"),
    count("messages_inbox"),
    count("chat_conversations"),
    count("tax_rule_verifications"),
    getPrefs(ctx),
    count("ingest_tokens", (q) => q.is("revoked_at", null)),
  ]);

  const groups: { title: string; steps: Step[] }[] = [
    {
      title: "Essentials",
      steps: [
        { title: "Sign in with MFA", why: "You're here, so this is done.", done: true, href: "/settings", cta: "Settings" },
        { title: "Connect Jarvis to Claude", why: "Lets you talk to Jarvis by voice on your iPhone and desktop.", done: mcpUsed > 0, href: "/settings?tab=connections", cta: "Get connector URL" },
        { title: "Install on your iPhone", why: "Safari → Share → Add to Home Screen. Then Siri “Jarvis” and the Action Button.", done: push > 0, href: `${DOCS}/docs/IPHONE-SHORTCUTS.md`, cta: "Guide", external: true },
        { title: "Turn on notifications", why: "Morning briefing at 07:00, Sunday review, deadline reminders.", done: push > 0, href: "/settings?tab=connections#notifications", cta: "Enable" },
      ],
    },
    {
      title: "Business",
      steps: [
        { title: "Connect Xero", why: "Revenue, invoices, VAT and drafting invoices, quotes and POs.", done: xero, href: "/settings?tab=connections", cta: "Connect" },
        { title: "Connect Outlook, Calendar and To Do", why: "Tasks, diary and email drafts.", done: ms, href: "/settings?tab=connections", cta: "Connect" },
        { title: "Connect the Qevero CRM", why: "Pipeline, CRM tasks and tenders.", done: crmConfigured(), href: `${DOCS}/README.md#7-qevero-crm-connector`, cta: "Guide", external: true },
        { title: "Confirm tax rules with your accountant", why: "Removes the “unverified” badges on deadlines.", done: verified >= 4, href: "/tax", cta: "Tax page" },
        { title: "Companies House key", why: "Cross-checks filing deadlines automatically.", done: Boolean(env.companiesHouseKey()), href: `${DOCS}/README.md#9-companies-house-optional`, cta: "Guide", external: true, optional: true },
      ],
    },
    {
      title: "Life",
      steps: [
        { title: "Create your iPhone device token", why: "Lets your phone send health data, captures and messages.", done: tokens > 0, href: "/settings?tab=devices", cta: "Create token" },
        { title: "Health Sync (MyFitnessPal + weight)", why: "A nightly Shortcut sends Apple Health totals to Jarvis.", done: healthDays > 0, href: `${DOCS}/docs/IPHONE-SHORTCUTS.md#2-jarvis-health-sync-myfitnesspal-and-weight--jarvis-daily-automatic`, cta: "Guide", external: true },
        { title: "Set your goals", why: "Calories, protein, target weight, sessions per week.", done: prefs.calorieTarget > 0 || prefs.targetWeightKg > 0, href: "/settings?tab=personal", cta: "Set goals" },
        { title: "Connect Hevy", why: "Lifts, sets and PRs (needs Hevy Pro).", done: hevy, href: "/settings?tab=personal", cta: "Add key", optional: true },
        { title: "“Send to Jarvis” share sheet", why: "Share links, notes and WhatsApp chats to Jarvis from any app.", done: captures > 0, href: `${DOCS}/docs/IPHONE-SHORTCUTS.md#5-send-to-jarvis-share-sheet`, cta: "Guide", external: true },
        { title: "Missed messages", why: "iMessage automation now; WhatsApp chats via the share sheet; full automation when you get a Mac.", done: msgs > 0, href: `${DOCS}/docs/MESSAGES.md`, cta: "Guide", external: true },
        { title: "Import your Claude history", why: "So Jarvis remembers what you've discussed before.", done: chats > 0, href: "/memory", cta: "Import", optional: true },
      ],
    },
  ];

  const all = groups.flatMap((g) => g.steps.filter((s) => !s.optional));
  const done = all.filter((s) => s.done).length;

  return (
    <div className="space-y-6 fade-in">
      <PageHeader label="Setup" title="Get Jarvis fully running" sub="Each step unlocks something. Do them in any order — this page ticks itself off as things connect.">
        <a href={`${DOCS}/docs/SETUP-EASY.md`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Step-by-step guide</a>
      </PageHeader>
      <div className="panel p-5">
        <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Progress</span><span className="num text-lg font-semibold">{done}/{all.length}</span></div>
        <div className="bar mt-2"><span style={{ width: `${(done / all.length) * 100}%` }} /></div>
      </div>
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-3 text-[0.95rem] font-semibold">{g.title}</h2>
          <ul className="panel divide-y divide-line">
            {g.steps.map((s) => (
              <li key={s.title} className="flex items-center gap-4 px-5 py-4">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm ${s.done ? "border-ok bg-ok/15 text-ok" : "border-line-strong text-muted"}`} aria-label={s.done ? "Done" : "To do"}>{s.done ? "✓" : ""}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${s.done ? "text-muted line-through decoration-muted/40" : ""}`}>{s.title}{s.optional && <span className="badge ml-2">Optional</span>}</p>
                  <p className="text-xs text-muted">{s.why}</p>
                </div>
                {!s.done && (s.external ? <a href={s.href} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm shrink-0">{s.cta} ↗</a> : <Link href={s.href} className="btn btn-ghost btn-sm shrink-0">{s.cta}</Link>)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

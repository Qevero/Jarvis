import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate, todayUk } from "@/lib/dates";
import { gatherBriefing } from "@/lib/services/briefing";
import { createVaultService } from "@/lib/vault/service";
import { supabaseVaultStore } from "@/lib/vault/store";
import { env } from "@/lib/env";
import { Panel } from "@/components/ui";
import { QuickNote, SpeakButton } from "@/components/voice";

export const dynamic = "force-dynamic";

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const ORDER = ["attention", "calendar", "tasks", "money", "deadlines", "crm", "journal"];
const LINKS: Record<string, string> = { attention: "/revenue", calendar: "/work", tasks: "/work", money: "/revenue", deadlines: "/tax", crm: "/crm", journal: "/journal" };

export default async function HomePage() {
  const ctx = await dashboardCtx("/");
  // First visit: seed the Company Vault with what we know.
  await createVaultService(supabaseVaultStore(ctx.sb), { key: env.vaultKey(), actor: { source: "dashboard" } }).seedDefaults();
  const b = await gatherBriefing(ctx);
  const sections = [...b.sections].sort((a, z) => ORDER.indexOf(a.id) - ORDER.indexOf(z.id));
  const notConnected = Object.entries(b.integrations).filter(([, v]) => v !== "active" && v !== "configured");

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="hud-label">{formatUkDate(todayUk())} · Morning briefing</p>
          <h1 className="mt-1 text-2xl font-semibold">{greeting()}, Jasper.</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{b.headline}</p>
        </div>
        <div className="flex gap-2">
          <SpeakButton text={b.spoken} label="Read briefing" />
          <a href="https://claude.ai/new" className="btn btn-primary btn-sm">Ask Jarvis</a>
        </div>
      </section>

      {notConnected.length > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          Not connected yet: {notConnected.map(([k]) => ({ xero: "Xero", microsoft: "Outlook/To Do", crm: "CRM" })[k as "xero"]).join(", ")}.{" "}
          <Link href="/settings" className="text-accent underline">Set up in Settings</Link>
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {sections.map((s) => (
          <Panel key={s.id} title={s.title} action={<Link href={LINKS[s.id] ?? "/"} className="text-xs text-accent">Open →</Link>}>
            <ul className="space-y-1.5 text-sm">
              {s.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </Panel>
        ))}
        <Panel title="Quick note">
          <QuickNote />
        </Panel>
      </div>
    </div>
  );
}

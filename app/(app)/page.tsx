import Link from "next/link";
import { formatUkDate, todayUk } from "@/lib/dates";
import { dashboardVault } from "@/lib/vault/dashboard";
import { ITEM_KIND_LABELS } from "@/lib/vault/fields";
import { upcomingRenewals, vaultCompleteness } from "@/lib/vault/summary";

export const dynamic = "force-dynamic";

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const MODULES = [
  { name: "Thought journal", phase: 2, note: "Talk it through in Claude; Jarvis files it." },
  { name: "To-dos & Outlook", phase: 3, note: "Microsoft To Do, calendar and email drafts." },
  { name: "Revenue", phase: 4, note: "Xero sync, revenue by stream, attention flags." },
  { name: "Tax & compliance", phase: 5, note: "Deadlines, VAT position, money to set aside." },
];

export default async function HomePage() {
  const { vault } = await dashboardVault("/");
  await vault.seedDefaults();
  const [profile, items] = await Promise.all([vault.getProfile(), vault.listItems()]);
  const today = todayUk();
  const completeness = vaultCompleteness(profile);
  const renewals = upcomingRenewals(items, today);
  const pct = Math.round((completeness.filled / completeness.total) * 100);

  return (
    <div className="space-y-5">
      <section>
        <p className="hud-label">{formatUkDate(today)} · Qevero Ltd</p>
        <h1 className="mt-1 text-2xl font-semibold">{greeting(new Date())}, Jasper.</h1>
      </section>

      <section className="panel flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="hud-label">Talk to Jarvis</p>
          <p className="mt-1 text-sm text-muted">Open Claude (Action Button or &ldquo;Hey Siri, Jarvis&rdquo;), tap voice mode, and ask. Make sure the Jarvis connector is switched on.</p>
        </div>
        <a href="https://claude.ai/new" className="btn btn-primary shrink-0">Open Claude</a>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="hud-label">Company Vault</p>
            <span className="font-mono text-sm text-accent">{pct}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-elev">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-sm">
            {completeness.filled} of {completeness.total} key details stored.
          </p>
          {completeness.missing.length > 0 && <p className="mt-1 text-sm text-muted">Missing: {completeness.missing.join(", ")}.</p>}
          <Link href="/vault" className="btn btn-ghost btn-sm mt-4">Open vault</Link>
        </section>

        <section className="panel p-5">
          <p className="hud-label">Renewals · next 90 days</p>
          {renewals.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing due. Add insurance policies and subscriptions in the vault to track renewals.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {renewals.map(({ item, daysAway }) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>
                    {item.name}
                    <span className="ml-2 text-xs text-muted">{ITEM_KIND_LABELS[item.kind].replace(/s$/, "")}</span>
                  </span>
                  <span className={`font-mono text-xs ${daysAway < 0 ? "text-danger" : daysAway <= 30 ? "text-warn" : "text-muted"}`}>
                    {formatUkDate(item.renewal_date)} · {daysAway < 0 ? `${-daysAway}d overdue` : `${daysAway}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <p className="hud-label mb-3">Coming online</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.name} className="panel p-4 opacity-70">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.name}</span>
                <span className="badge">Phase {m.phase}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{m.note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

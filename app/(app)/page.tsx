import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate, todayUk } from "@/lib/dates";
import { gatherBriefing } from "@/lib/services/briefing";
import { checkinData, inboxCount } from "@/lib/services/labs";
import { createVaultService } from "@/lib/vault/service";
import { supabaseVaultStore } from "@/lib/vault/store";
import { env } from "@/lib/env";
import { NAV_ICONS } from "@/lib/nav";
import { CheckinCard } from "@/components/checkin-card";
import { Icon } from "@/components/nav-links";
import { Panel, Progress, SectionTitle } from "@/components/ui";
import { QuickNote, SpeakButton } from "@/components/voice";

export const dynamic = "force-dynamic";

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()));
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function weatherEmoji(summary: string) {
  const s = summary.toLowerCase();
  if (s.includes("thunder")) return "⛈️";
  if (s.includes("snow")) return "🌨️";
  if (s.includes("rain") || s.includes("drizzle") || s.includes("shower")) return "🌧️";
  if (s.includes("fog")) return "🌫️";
  if (s.includes("overcast")) return "☁️";
  if (s.includes("partly")) return "⛅";
  return "☀️";
}

type Need = { tone: "danger" | "warn" | "accent"; title: string; href: string };

export default async function TodayPage() {
  const ctx = await dashboardCtx("/");
  await createVaultService(supabaseVaultStore(ctx.sb), { key: env.vaultKey(), actor: { source: "dashboard" } }).seedDefaults();
  const [b, checks, inbox] = await Promise.all([gatherBriefing(ctx), checkinData(ctx, 14).catch(() => null), inboxCount(ctx).catch(() => 0)]);
  const d = b.data;
  const today = todayUk();
  const w = d.weather?.days[0];

  const needs: Need[] = [];
  for (const f of d.flags ?? []) if (f.severity !== "low") needs.push({ tone: f.severity === "high" ? "danger" : "warn", title: f.title, href: "/revenue" });
  for (const dl of (d.deadlines ?? []).filter((x) => x.daysAway <= 14)) needs.push({ tone: dl.daysAway < 0 ? "danger" : "warn", title: `${dl.title} — ${dl.daysAway < 0 ? "overdue" : dl.daysAway === 0 ? "today" : `in ${dl.daysAway} days`}`, href: "/tax" });
  if (d.messages?.unseen) needs.push({ tone: "accent", title: `${d.messages.unseen} unread message${d.messages.unseen > 1 ? "s" : ""} in ${d.messages.chats} chat${d.messages.chats > 1 ? "s" : ""}`, href: "/messages" });
  if (inbox) needs.push({ tone: "accent", title: `${inbox} item${inbox > 1 ? "s" : ""} in your Inbox`, href: "/inbox" });
  for (const t of (d.tasksDue ?? []).filter((t) => t.overdue).slice(0, 3)) needs.push({ tone: "warn", title: `Overdue: ${t.title}`, href: "/work" });

  const notConnected = Object.entries(b.integrations).filter(([, v]) => v !== "active" && v !== "configured").length;
  const actions = [
    { href: "https://claude.ai/new", label: "Ask Jarvis", icon: NAV_ICONS.search, primary: true },
    { href: "/inbox", label: "Capture", icon: NAV_ICONS.inbox },
    { href: "/health#log", label: "Log weight", icon: NAV_ICONS.health },
    { href: "/invoices?tab=new", label: "Invoice", icon: NAV_ICONS.invoice },
    { href: "/journal", label: "Journal", icon: NAV_ICONS.journal },
  ];

  return (
    <div className="space-y-6 fade-in">
      {/* Hero */}
      <section className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="hud-label">{new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(new Date())} · {formatUkDate(today)}</p>
          <h1 className="mt-1.5 text-[2rem] font-semibold leading-tight tracking-tight">{greeting()}, Jasper.</h1>
          <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-muted">{b.headline}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {w && <span className="chip"><span aria-hidden="true">{weatherEmoji(w.summary)}</span><span className="num">{w.minC}–{w.maxC}°</span><span className="text-muted">{w.summary}{w.rainChancePct !== null && w.rainChancePct >= 30 ? ` · ☔ ${w.rainChancePct}%` : ""}</span></span>}
          <SpeakButton text={b.spoken} label="Briefing" />
        </div>
      </section>

      {/* Quick actions */}
      <nav aria-label="Quick actions" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {actions.map((a) => (
          <a key={a.label} href={a.href} target={a.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={`btn shrink-0 ${a.primary ? "btn-primary" : "btn-ghost"}`}>
            <Icon d={a.icon} className="h-4 w-4" />{a.label}
          </a>
        ))}
      </nav>

      {notConnected > 0 && (
        <Link href="/setup" className="flex items-center justify-between rounded-2xl border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm">
          <span>Finish setting up Jarvis — {notConnected} connection{notConnected > 1 ? "s" : ""} to go.</span>
          <span className="text-accent">Setup →</span>
        </Link>
      )}

      {/* Needs you */}
      <section>
        <SectionTitle>Needs you</SectionTitle>
        {needs.length === 0 ? (
          <div className="panel px-5 py-4 text-sm text-muted">All clear. Nothing urgent today. ✓</div>
        ) : (
          <ul className="panel divide-y divide-line">
            {needs.slice(0, 7).map((n, i) => (
              <li key={i}>
                <Link href={n.href} className="flex min-h-13 items-center gap-3 px-5 py-3 text-sm hover:bg-white/[0.02]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${n.tone === "danger" ? "bg-danger" : n.tone === "warn" ? "bg-warn" : "bg-accent"}`} aria-hidden="true" />
                  <span className="flex-1">{n.title}</span>
                  <span className="text-muted" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today */}
        <section>
          <SectionTitle action={<Link href="/work" className="text-xs text-accent">All →</Link>}>Today</SectionTitle>
          <div className="panel p-5">
            {d.calendar === null ? (
              <p className="text-sm text-muted">Connect Outlook in Settings to see your diary and tasks here.</p>
            ) : (
              <ul className="space-y-3">
                {(d.calendar ?? []).length === 0 && <li className="text-sm text-muted">Nothing in the diary.</li>}
                {(d.calendar ?? []).map((e, i) => (
                  <li key={i} className="flex gap-4 text-sm"><span className="num w-12 shrink-0 text-muted">{e.allDay ? "All day" : e.start.slice(11, 16)}</span><span>{e.subject}{e.location ? <span className="text-muted"> · {e.location}</span> : null}</span></li>
                ))}
                {(d.tasksDue ?? []).slice(0, 5).map((t, i) => (
                  <li key={`t${i}`} className="flex gap-4 text-sm"><span className="w-12 shrink-0 text-muted">Task</span><span className={t.overdue ? "text-warn" : ""}>{t.title}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Pulse */}
        <section>
          <SectionTitle>Pulse</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/revenue" className="tile">
              <span className="hud-label">Revenue this month</span>
              <span className="num mt-auto text-2xl font-semibold">{d.revenue ? gbp(d.revenue.monthToDate) : "—"}</span>
              <span className="text-xs text-muted">{d.revenue?.projected ? `On pace for ${gbp(d.revenue.projected)}` : "Connect Xero"}</span>
            </Link>
            <Link href="/tax" className="tile">
              <span className="hud-label">Cash after tax</span>
              <span className="num mt-auto text-2xl font-semibold">{d.cash ? gbp(d.cash.total - (d.setAside?.total ?? 0)) : "—"}</span>
              <span className="text-xs text-muted">{d.setAside ? `${gbp(d.setAside.total)} set aside` : "Estimate"}</span>
            </Link>
            <Link href="/health" className="tile">
              <span className="hud-label">Weight · 7-day avg</span>
              <span className="num mt-auto text-2xl font-semibold">{d.health?.weightAvg ? `${d.health.weightAvg} kg` : "—"}</span>
              <span className="text-xs text-muted">{d.health?.perWeekKg !== null && d.health?.perWeekKg !== undefined ? `${d.health.perWeekKg > 0 ? "+" : ""}${d.health.perWeekKg} kg/week` : "Set up Health Sync"}</span>
            </Link>
            <Link href="/health" className="tile">
              <span className="hud-label">Training this week</span>
              <span className="num mt-auto text-2xl font-semibold">{d.health ? `${d.health.sessionsThisWeek}${d.health.sessionsTarget ? `/${d.health.sessionsTarget}` : ""}` : "—"}</span>
              <span className="text-xs text-muted">{d.health?.lastWorkout ?? "Connect Hevy"}</span>
            </Link>
          </div>
          {d.health && (d.health.kcalTarget || d.health.proteinTarget) ? (
            <div className="panel mt-3 space-y-3 p-5">
              <Progress label="Calories yesterday" value={d.health.yesterdayKcal} target={d.health.kcalTarget} invert />
              <Progress label="Protein yesterday" value={d.health.yesterdayProtein} target={d.health.proteinTarget} unit=" g" />
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="checkin">
          <SectionTitle action={<span className="badge">Labs</span>}>{checks?.today ? "Today's check-in ✓" : "How are you today?"}</SectionTitle>
          <Panel><CheckinCard compact initial={checks?.today ? { mood: checks.today.mood ?? undefined, energy: checks.today.energy ?? undefined, sleep: checks.today.sleep ?? undefined, stress: checks.today.stress ?? undefined } : undefined} /></Panel>
        </section>
        <section>
          <SectionTitle>Quick note</SectionTitle>
          <Panel><QuickNote /></Panel>
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate } from "@/lib/dates";
import { NAV_ICONS } from "@/lib/nav";
import { healthSummary, loadHealth, messageCounts } from "@/lib/services/personal";
import { checkinData } from "@/lib/services/labs";
import { searchJournal } from "@/lib/services/journal";
import { memoryStats } from "@/lib/services/knowledge";
import { CheckinCard } from "@/components/checkin-card";
import { PageHeader, Panel, Progress, SectionTitle, Tile } from "@/components/ui";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export default async function LifePage() {
  const ctx = await dashboardCtx("/life");
  const [health, msgs, checks, journal, mem] = await Promise.all([safe(async () => healthSummary(await loadHealth(ctx, 90), 7)), safe(() => messageCounts(ctx)), safe(() => checkinData(ctx, 30)), safe(() => searchJournal(ctx, { limit: 1 })), safe(() => memoryStats(ctx))]);
  const n = health?.nutrition;
  const week = health?.training.weeks.at(-1);

  return (
    <div className="space-y-6 fade-in">
      <PageHeader label="Life" title="You, at a glance" sub="Health, training, messages and the things you want Jarvis to remember." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/health" label="Weight · 7-day avg" icon={NAV_ICONS.health} value={health?.weight ? `${health.weight.latestAvg} kg` : "—"} sub={health?.weight ? `${health.weight.perWeekKg > 0 ? "+" : ""}${health.weight.perWeekKg} kg/week${health.weight.toGoKg !== null ? ` · ${Math.abs(health.weight.toGoKg)} kg to go` : ""}` : "Set up Health Sync"} />
        <Tile href="/health" label="Calories · 7-day avg" icon={NAV_ICONS.health} value={n?.avgKcal ? n.avgKcal.toLocaleString("en-GB") : "—"} sub={n?.kcalTarget ? `Target ${n.kcalTarget.toLocaleString("en-GB")}` : `${n?.daysLogged ?? 0}/7 days logged`} progress={n?.avgKcal && n.kcalTarget ? n.avgKcal / n.kcalTarget : null} />
        <Tile href="/health" label="Training this week" icon={NAV_ICONS.health} value={`${week?.sessions ?? 0}${health?.training.target ? `/${health.training.target}` : ""}`} sub={health?.training.lastWorkout ? `Last: ${health.training.lastWorkout.title}` : "Connect Hevy"} progress={health?.training.target ? (week?.sessions ?? 0) / health.training.target : null} />
        <Tile href="/messages" label="Unread messages" icon={NAV_ICONS.messages} value={String(msgs?.unseen ?? 0)} sub={msgs?.unseen ? `${msgs.chats} chat${msgs.chats === 1 ? "" : "s"}` : "All caught up"} />
      </div>

      {n && (n.kcalTarget || n.proteinTarget) ? (
        <Panel title="This week vs your targets" className="space-y-3">
          <div className="space-y-3">
            <Progress label="Average calories" value={n.avgKcal} target={n.kcalTarget} invert />
            <Progress label="Average protein" value={n.avgProtein} target={n.proteinTarget} unit=" g" />
            {health?.training.target ? <Progress label="Sessions" value={week?.sessions ?? 0} target={health.training.target} /> : null}
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="checkin" className="scroll-mt-6">
          <SectionTitle action={<span className="badge">Labs</span>}>Daily check-in</SectionTitle>
          <Panel>
            <CheckinCard initial={checks?.today ? { mood: checks.today.mood ?? undefined, energy: checks.today.energy ?? undefined, sleep: checks.today.sleep ?? undefined, stress: checks.today.stress ?? undefined, note: checks.today.note } : undefined} />
            {checks && checks.averages.days > 0 && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Last 7 days: mood {checks.averages.mood ?? "—"} · energy {checks.averages.energy ?? "—"} · sleep {checks.averages.sleep ?? "—"} · stress {checks.averages.stress ?? "—"} (out of 5)
              </p>
            )}
            {checks?.insights.map((i) => <p key={i} className="mt-2 text-xs text-accent">◆ {i}</p>)}
          </Panel>
        </section>
        <section>
          <SectionTitle>Mind</SectionTitle>
          <div className="grid gap-3">
            <Tile href="/journal" label="Journal" icon={NAV_ICONS.journal} value={journal?.[0] ? journal[0].title : "Start writing"} sub={journal?.[0] ? `Latest · ${formatUkDate(journal[0].entry_date)}` : "Or tell Claude what's on your mind"} />
            <Tile href="/memory" label="Memory" icon={NAV_ICONS.memory} value={`${mem?.memories ?? 0} things remembered`} sub={mem?.conversations ? `${mem.conversations} past chats imported` : "Import your Claude history"} />
            <Link href="/review" className="btn btn-ghost">Weekly review →</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

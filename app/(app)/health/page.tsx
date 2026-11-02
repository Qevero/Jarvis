import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate } from "@/lib/dates";
import { weightTrend, liftRecords } from "@/lib/health/analytics";
import { healthSummary, loadHealth } from "@/lib/services/personal";
import { SERIES_COLOURS } from "@/lib/chart-colours";
import { StackedBars, TrendLine } from "@/components/charts";
import { ActionForm } from "@/components/forms";
import { Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { logHealthAction, syncHevyAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const ctx = await dashboardCtx("/health");
  const d = await loadHealth(ctx, 90);
  const s = healthSummary(d, 7);
  const trend = weightTrend(d.rows).filter((p) => p.day >= d.rows[0]?.day);
  const { data: hevy } = await ctx.sb.from("integration_connections").select("status").eq("owner_id", ctx.ownerId).eq("provider", "hevy").maybeSingle();
  const hasData = s.dataSources.healthDays > 0 || s.dataSources.workouts > 0;
  const n = s.nutrition;
  const weeks = s.training.weeks;
  const best = liftRecords(d.workouts, d.today).best.slice(0, 8);
  const last14 = d.rows.filter((r) => r.energy_kcal !== null).slice(-14);

  return (
    <div className="space-y-5">
      <PageHeader label="Personal" title="Health & training" sub="Nutrition and weight from MyFitnessPal via Apple Health; lifts from Hevy. Ask Jarvis “how's my week looking?”">
        {hevy?.status === "active" && <ActionForm action={syncHevyAction} submit="Refresh Hevy"><span /></ActionForm>}
      </PageHeader>

      {!hasData && (
        <Empty action={<Link href="/settings#personal" className="btn btn-primary btn-sm">Set up devices</Link>}>
          No health data yet. Set up the “Jarvis Health Sync” iPhone Shortcut (sends MyFitnessPal calories and your weight from Apple Health each evening) and connect Hevy in Settings → Personal. Step-by-step: docs/IPHONE-SHORTCUTS.md.
        </Empty>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Calories · 7-day avg" value={n.avgKcal !== null ? `${n.avgKcal.toLocaleString("en-GB")}` : "—"} sub={n.kcalTarget ? `Target ${n.kcalTarget.toLocaleString("en-GB")} · ${n.daysWithinKcalTarget}/${n.daysLogged} days on target` : `${n.daysLogged} of 7 days logged`} />
        <Stat label="Protein · 7-day avg" value={n.avgProtein !== null ? `${n.avgProtein} g` : "—"} sub={n.proteinTarget ? `Target ${n.proteinTarget} g · hit ${n.proteinTargetHitDays} days` : undefined} />
        <Stat label="Weight · 7-day avg" value={s.weight ? `${s.weight.latestAvg} kg` : "—"} sub={s.weight ? `${s.weight.perWeekKg > 0 ? "+" : ""}${s.weight.perWeekKg} kg/week${s.weight.toGoKg !== null ? ` · ${Math.abs(s.weight.toGoKg)} kg ${s.weight.toGoKg > 0 ? "to lose" : "to gain"}` : ""}` : "No weigh-ins yet"} />
        <Stat label="Sessions · this week" value={String(weeks[weeks.length - 1]?.sessions ?? 0)} sub={s.training.target ? `Target ${s.training.target}/week` : s.training.lastWorkout ? `Last: ${s.training.lastWorkout.title}` : undefined} tone={s.training.target && (weeks[weeks.length - 1]?.sessions ?? 0) >= s.training.target ? "ok" : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Weight · last 90 days">
          <TrendLine title="Weight with 7-day average" unit="kg" target={d.prefs.targetWeightKg || null} points={trend.map((p) => ({ day: p.day, value: p.kg, avg: p.avg }))} />
        </Panel>
        <Panel title="Calories · last 14 logged days">
          <StackedBars title="Daily calories" categories={last14.map((r) => `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`)} series={[{ id: "kcal", label: "Calories", colour: SERIES_COLOURS[1], values: last14.map((r) => Number(r.energy_kcal)) }]} />
          {n.kcalTarget && <p className="mt-1 text-xs text-muted">Target {n.kcalTarget.toLocaleString("en-GB")} kcal/day.</p>}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Training volume · last 6 weeks (kg lifted)">
          <StackedBars title="Weekly training volume" categories={weeks.map((w) => formatUkDate(w.weekStart).slice(0, 5))} series={[{ id: "vol", label: "Volume", colour: SERIES_COLOURS[0], values: weeks.map((w) => w.volumeKg) }]} />
          <p className="mt-1 text-xs text-muted">Sessions per week: {weeks.map((w) => w.sessions).join(" · ")}</p>
        </Panel>
        <Panel title="Best lifts (estimated 1RM)">
          {best.length === 0 ? <p className="text-sm text-muted">Connect Hevy to see lifts.</p> : (
            <ul className="divide-y divide-line text-sm">
              {best.map((b) => <li key={b.exercise} className="flex justify-between gap-3 py-2"><span>{b.exercise}</span><span className="font-mono tabular-nums">{b.e1rm} kg <span className="text-xs text-muted">({b.weightKg}×{b.reps}, {formatUkDate(b.day)})</span></span></li>)}
            </ul>
          )}
          {s.records.length > 0 && <p className="mt-3 text-sm text-ok">New PRs in the last 2 weeks: {s.records.map((r) => `${r.exercise} ${r.weightKg}×${r.reps}`).join(", ")}</p>}
        </Panel>
      </div>

      <Panel title="Log manually">
        <ActionForm action={logHealthAction} submit="Log" resetOnSuccess>
          <div className="grid gap-2 sm:grid-cols-4">
            <input name="day" placeholder="Date (today)" className="input" />
            <input name="weight" placeholder="Weight e.g. 82.4 kg / 181 lb" className="input" />
            <input name="calories" placeholder="Calories" inputMode="numeric" className="input" />
            <input name="protein" placeholder="Protein g" inputMode="numeric" className="input" />
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}

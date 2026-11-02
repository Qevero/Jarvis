import { addDays } from "@/lib/periods";
import { daysBetween } from "@/lib/dates";

/** Personal health & training analytics. Pure and deterministic. */

export type DayRow = { day: string; energy_kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; weight_kg: number | null; steps: number | null; active_kcal: number | null; sleep_hours: number | null };
export type SetRow = { type?: string; weight_kg?: number | null; reps?: number | null; distance_m?: number | null; duration_s?: number | null };
export type ExerciseRow = { title: string; sets: SetRow[] };
export type WorkoutRow = { workout_id: string; source: string; title: string | null; started_at: string; duration_min: number | null; volume_kg: number | null; set_count: number | null; exercises: ExerciseRow[] };

const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Trailing moving average of weight (kg) over `window` days, for each day that has a weigh-in. */
export function weightTrend(days: DayRow[], window = 7) {
  const weighed = days.filter((d) => num(d.weight_kg) !== null).map((d) => ({ day: d.day, kg: Number(d.weight_kg) })).sort((a, b) => a.day.localeCompare(b.day));
  return weighed.map((p) => {
    const from = addDays(p.day, -(window - 1));
    const inWin = weighed.filter((q) => q.day >= from && q.day <= p.day).map((q) => q.kg);
    return { day: p.day, kg: p.kg, avg: r1(avg(inWin)!) };
  });
}

/** Weekly rate of change of the moving average over the last `days` days (kg/week; negative = losing). */
export function weightChange(days: DayRow[], today: string, span = 28) {
  const t = weightTrend(days);
  if (t.length < 2) return null;
  const latest = t[t.length - 1];
  const earlier = [...t].reverse().find((p) => daysBetween(p.day, latest.day) >= Math.min(span, daysBetween(t[0].day, latest.day)) && p !== latest) ?? t[0];
  const gap = daysBetween(earlier.day, latest.day);
  if (gap <= 0) return null;
  return { latestKg: latest.kg, latestAvg: latest.avg, fromDay: earlier.day, toDay: latest.day, changeKg: r1(latest.avg - earlier.avg), perWeekKg: r1(((latest.avg - earlier.avg) / gap) * 7), staleDays: daysBetween(latest.day, today) };
}

/** Nutrition over the last `n` days (days with a calorie entry count as logged). */
export function nutritionSummary(days: DayRow[], today: string, n = 7, targets: { kcal?: number; protein?: number } = {}) {
  const from = addDays(today, -(n - 1));
  const logged = days.filter((d) => d.day >= from && d.day <= today && num(d.energy_kcal) !== null && Number(d.energy_kcal) > 0);
  const k = logged.map((d) => Number(d.energy_kcal));
  const p = logged.filter((d) => num(d.protein_g) !== null).map((d) => Number(d.protein_g));
  const within = targets.kcal ? logged.filter((d) => Math.abs(Number(d.energy_kcal) - targets.kcal!) <= targets.kcal! * 0.1).length : null;
  return {
    days: n,
    daysLogged: logged.length,
    avgKcal: k.length ? Math.round(avg(k)!) : null,
    avgProtein: p.length ? Math.round(avg(p)!) : null,
    avgCarbs: (() => { const c = logged.filter((d) => num(d.carbs_g) !== null).map((d) => Number(d.carbs_g)); return c.length ? Math.round(avg(c)!) : null; })(),
    avgFat: (() => { const f = logged.filter((d) => num(d.fat_g) !== null).map((d) => Number(d.fat_g)); return f.length ? Math.round(avg(f)!) : null; })(),
    kcalTarget: targets.kcal || null,
    proteinTarget: targets.protein || null,
    daysWithinKcalTarget: within,
    proteinTargetHitDays: targets.protein ? p.filter((x) => x >= targets.protein!).length : null,
  };
}

/** Consecutive days (ending today or yesterday) with food logged. */
export function loggingStreak(days: DayRow[], today: string) {
  const logged = new Set(days.filter((d) => num(d.energy_kcal) !== null && Number(d.energy_kcal) > 0).map((d) => d.day));
  let d = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Epley estimated one-rep max. */
export function e1rm(weightKg: number, reps: number) {
  if (!(weightKg > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weightKg : r1(weightKg * (1 + reps / 30));
}

export function workoutVolume(exercises: ExerciseRow[]) {
  let volume = 0, sets = 0;
  for (const ex of exercises) for (const s of ex.sets ?? []) {
    if (s.type === "warmup") continue;
    sets++;
    volume += (Number(s.weight_kg) || 0) * (Number(s.reps) || 0);
  }
  return { volumeKg: r1(volume), sets };
}

/** Training load: sessions and volume per ISO-ish week (Monday start) for the last `weeks` weeks. */
export function trainingWeeks(workouts: WorkoutRow[], today: string, weeks = 6) {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const thisMonday = addDays(today, -dow);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisMonday, -7 * (weeks - 1 - i));
    const end = addDays(start, 6);
    const w = workouts.filter((x) => x.started_at.slice(0, 10) >= start && x.started_at.slice(0, 10) <= end);
    return { weekStart: start, sessions: w.length, volumeKg: r1(w.reduce((a, x) => a + (Number(x.volume_kg) || 0), 0)), minutes: Math.round(w.reduce((a, x) => a + (Number(x.duration_min) || 0), 0)) };
  });
}

/** Best estimated 1RM per exercise, and personal records set in the last `recentDays` days. */
export function liftRecords(workouts: WorkoutRow[], today: string, recentDays = 14) {
  const best = new Map<string, { exercise: string; e1rm: number; weightKg: number; reps: number; day: string }>();
  const sorted = [...workouts].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const prs: { exercise: string; e1rm: number; weightKg: number; reps: number; day: string; previous: number }[] = [];
  for (const w of sorted) {
    for (const ex of w.exercises ?? []) {
      let top: { e: number; kg: number; reps: number } | null = null;
      for (const s of ex.sets ?? []) {
        if (s.type === "warmup") continue;
        const e = e1rm(Number(s.weight_kg) || 0, Number(s.reps) || 0);
        if (e > 0 && (!top || e > top.e)) top = { e, kg: Number(s.weight_kg), reps: Number(s.reps) };
      }
      if (!top) continue;
      const key = ex.title.trim().toLowerCase();
      const prev = best.get(key);
      const day = w.started_at.slice(0, 10);
      if (!prev || top.e > prev.e1rm) {
        if (prev && daysBetween(day, today) <= recentDays) prs.push({ exercise: ex.title, e1rm: top.e, weightKg: top.kg, reps: top.reps, day, previous: prev.e1rm });
        best.set(key, { exercise: ex.title, e1rm: top.e, weightKg: top.kg, reps: top.reps, day });
      }
    }
  }
  return { best: [...best.values()].sort((a, b) => b.e1rm - a.e1rm), recentPRs: prs.reverse() };
}

/** History of one lift: best set per session. */
export function liftHistory(workouts: WorkoutRow[], exercise: string) {
  const key = exercise.trim().toLowerCase();
  const out: { day: string; weightKg: number; reps: number; e1rm: number; sets: number }[] = [];
  for (const w of [...workouts].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    for (const ex of w.exercises ?? []) {
      if (!ex.title.toLowerCase().includes(key)) continue;
      const work = (ex.sets ?? []).filter((s) => s.type !== "warmup");
      let top: { kg: number; reps: number; e: number } | null = null;
      for (const s of work) {
        const e = e1rm(Number(s.weight_kg) || 0, Number(s.reps) || 0);
        if (!top || e > top.e) top = { kg: Number(s.weight_kg) || 0, reps: Number(s.reps) || 0, e };
      }
      if (top) out.push({ day: w.started_at.slice(0, 10), weightKg: top.kg, reps: top.reps, e1rm: top.e, sets: work.length });
    }
  }
  return out;
}

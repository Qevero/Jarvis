import { createHash, randomBytes } from "node:crypto";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit, getPrefs, UserError, type Ctx } from "@/lib/ctx";
import { parseDate, todayUk } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { liftHistory, liftRecords, loggingStreak, nutritionSummary, trainingWeeks, weightChange, weightTrend, type DayRow, type WorkoutRow } from "@/lib/health/analytics";
import { parseMeasure } from "@/lib/health/normalise";
import { groupByChat } from "@/lib/messages/normalise";
import { getForecast } from "@/lib/weather";

/** Personal side of Jarvis: health, training, weather, missed messages, device tokens. */

// ─── Health & training ────────────────────────────────────────────────────
export async function loadHealth(ctx: Ctx, days = 90) {
  const today = todayUk();
  const from = addDays(today, -days);
  const [h, w, prefs] = await Promise.all([
    ctx.sb.from("health_daily").select("day, energy_kcal, protein_g, carbs_g, fat_g, weight_kg, steps, active_kcal, sleep_hours").eq("owner_id", ctx.ownerId).gte("day", from).order("day"),
    ctx.sb.from("workouts").select("workout_id, source, title, started_at, duration_min, volume_kg, set_count, exercises").eq("owner_id", ctx.ownerId).gte("started_at", `${addDays(today, -Math.max(days, 180))}T00:00:00Z`).order("started_at"),
    getPrefs(ctx),
  ]);
  const rows = ((h.data ?? []) as DayRow[]).map((r) => ({ ...r, energy_kcal: r.energy_kcal === null ? null : Number(r.energy_kcal), protein_g: r.protein_g === null ? null : Number(r.protein_g), weight_kg: r.weight_kg === null ? null : Number(r.weight_kg) }));
  const workouts = (w.data ?? []) as WorkoutRow[];
  return { today, rows, workouts, prefs };
}

export function healthSummary(d: Awaited<ReturnType<typeof loadHealth>>, period = 7) {
  const { today, rows, workouts, prefs } = d;
  const weight = weightChange(rows, today, 28);
  const recent = workouts.filter((w) => w.started_at.slice(0, 10) >= addDays(today, -(period - 1)));
  const yesterday = rows.find((r) => r.day === addDays(today, -1)) ?? null;
  const todayRow = rows.find((r) => r.day === today) ?? null;
  return {
    period: `${period} days`,
    nutrition: nutritionSummary(rows, today, period, { kcal: prefs.calorieTarget || undefined, protein: prefs.proteinTarget || undefined }),
    loggingStreakDays: loggingStreak(rows, today),
    weight: weight ? { ...weight, targetKg: prefs.targetWeightKg || null, toGoKg: prefs.targetWeightKg ? Math.round((weight.latestAvg - prefs.targetWeightKg) * 10) / 10 : null } : null,
    training: { sessions: recent.length, target: prefs.workoutsPerWeek ? Math.round((prefs.workoutsPerWeek * period) / 7) : null, lastWorkout: workouts.length ? { title: workouts[workouts.length - 1].title, day: workouts[workouts.length - 1].started_at.slice(0, 10), volumeKg: workouts[workouts.length - 1].volume_kg } : null, weeks: trainingWeeks(workouts, today, 6) },
    records: liftRecords(workouts, today, 14).recentPRs.slice(0, 5),
    today: todayRow,
    yesterday,
    dataSources: { healthDays: rows.length, workouts: workouts.length },
  };
}

export async function weightSeries(ctx: Ctx, days = 90) {
  const d = await loadHealth(ctx, days);
  return { trend: weightTrend(d.rows), change: weightChange(d.rows, d.today, 28), targetKg: d.prefs.targetWeightKg || null };
}

export async function liftProgress(ctx: Ctx, exercise?: string | null) {
  const d = await loadHealth(ctx, 365);
  if (!exercise) return { best: liftRecords(d.workouts, d.today).best.slice(0, 15) };
  const history = liftHistory(d.workouts, exercise);
  if (!history.length) throw new UserError(`No sessions found for "${exercise}". Try the name as it appears in Hevy, e.g. "Bench Press".`);
  return { exercise, sessions: history.slice(-20), best: history.reduce((a, b) => (b.e1rm > a.e1rm ? b : a)) };
}

export async function logHealth(ctx: Ctx, input: { day?: string | null; weight?: string | number | null; calories?: string | number | null; protein?: string | number | null }) {
  const day = input.day ? parseDate(input.day) : todayUk();
  if (!day) throw new UserError("Use DD/MM/YYYY.");
  const row: Record<string, unknown> = { owner_id: ctx.ownerId, day, source: "manual", updated_at: new Date().toISOString() };
  const w = parseMeasure(input.weight, { lbToKg: true });
  const k = parseMeasure(input.calories);
  const p = parseMeasure(input.protein);
  if (w !== null) row.weight_kg = w;
  if (k !== null) row.energy_kcal = k;
  if (p !== null) row.protein_g = p;
  if (Object.keys(row).length <= 4) throw new UserError("Nothing to log.");
  const { error } = await ctx.sb.from("health_daily").upsert(row, { onConflict: "owner_id,day" });
  if (error) throw new Error(error.message);
  await audit(ctx, "health.log", day, { fields: Object.keys(row).filter((x) => !["owner_id", "day", "source", "updated_at"].includes(x)) });
  return { logged: day, weight_kg: row.weight_kg ?? null, energy_kcal: row.energy_kcal ?? null, protein_g: row.protein_g ?? null };
}

// ─── Weather ───────────────────────────────────────────────────────────────
export async function weatherFor(ctx: Ctx, days = 3) {
  const p = await getPrefs(ctx);
  return getForecast(p.homeLat, p.homeLon, p.homeLocationName, days);
}

// ─── Messages ──────────────────────────────────────────────────────────────
export async function missedMessages(ctx: Ctx, opts: { hours?: number; source?: string | null; includeSeen?: boolean; limit?: number } = {}) {
  let q = ctx.sb
    .from("messages_inbox")
    .select("id, source, chat_name, sender, is_group, sent_at, body_enc, seen_at")
    .eq("owner_id", ctx.ownerId)
    .gte("sent_at", new Date(Date.now() - (opts.hours ?? 24) * 3_600_000).toISOString())
    .order("sent_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 300, 1000));
  if (!opts.includeSeen) q = q.is("seen_at", null);
  if (opts.source) q = q.eq("source", opts.source);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const key = env.vaultKey();
  const msgs = (data ?? []).map((m) => {
    let text = "[unreadable]";
    try {
      text = decrypt(m.body_enc, key);
    } catch {
      // keep placeholder
    }
    return { id: m.id as string, source: m.source as string, chat_name: m.chat_name as string | null, sender: m.sender as string | null, is_group: m.is_group as boolean, sent_at: m.sent_at as string, text, seen: Boolean(m.seen_at) };
  });
  return { total: msgs.length, ids: msgs.map((m) => m.id), chats: groupByChat(msgs) };
}

export async function markMessagesSeen(ctx: Ctx, ids?: string[] | null) {
  let q = ctx.sb.from("messages_inbox").update({ seen_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).is("seen_at", null);
  if (ids?.length) q = q.in("id", ids.slice(0, 1000));
  const { error } = await q;
  if (error) throw new Error(error.message);
  await audit(ctx, "messages.mark_seen", null, { count: ids?.length ?? "all" });
  return { marked: ids?.length ?? "all" };
}

export async function messageCounts(ctx: Ctx) {
  const { data } = await ctx.sb.from("messages_inbox").select("source, chat_name").eq("owner_id", ctx.ownerId).is("seen_at", null).limit(2000);
  const rows = data ?? [];
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source as string] = (bySource[r.source as string] ?? 0) + 1;
  return { unseen: rows.length, chats: new Set(rows.map((r) => `${r.source}|${r.chat_name}`)).size, bySource };
}

// ─── Device ingest tokens ─────────────────────────────────────────────────
export const INGEST_SCOPES = ["health", "workouts", "messages"] as const;

export async function createIngestToken(ctx: Ctx, name: string, scopes: string[]) {
  const clean = scopes.filter((s) => (INGEST_SCOPES as readonly string[]).includes(s));
  if (!clean.length) throw new UserError("Choose at least one permission.");
  if (!name.trim()) throw new UserError("Name the device, e.g. “iPhone” or “MacBook”.");
  const token = `jv_${randomBytes(24).toString("base64url")}`;
  const { error } = await ctx.sb.from("ingest_tokens").insert({ owner_id: ctx.ownerId, name: name.trim().slice(0, 100), scopes: clean, token_hash: createHash("sha256").update(token).digest("hex") });
  if (error) throw new Error(error.message);
  await audit(ctx, "ingest.token_create", name, { scopes: clean });
  return token;
}

export async function listIngestTokens(ctx: Ctx) {
  const { data } = await ctx.sb.from("ingest_tokens").select("id, name, scopes, created_at, last_used_at, revoked_at").eq("owner_id", ctx.ownerId).order("created_at", { ascending: false });
  return data ?? [];
}

export async function revokeIngestToken(ctx: Ctx, id: string) {
  await ctx.sb.from("ingest_tokens").update({ revoked_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).eq("id", id);
  await audit(ctx, "ingest.token_revoke", id);
}

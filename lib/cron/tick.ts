import "server-only";
import { audit, getPrefs, type Ctx } from "@/lib/ctx";
import { formatUkDate, todayUk } from "@/lib/dates";
import { connectionStatus } from "@/lib/integrations/connections";
import { GraphClient } from "@/lib/ms/graph";
import { sendPush } from "@/lib/push";
import { supabaseAdmin, ownerUserId } from "@/lib/supabase/admin";
import { syncXero, lastSync } from "@/lib/xero/sync";
import { gatherBriefing } from "@/lib/services/briefing";
import { upcomingDeadlines } from "@/lib/services/tax";
import { syncHevy } from "@/lib/hevy/client";

/**
 * Hourly scheduled tick (Netlify scheduled function → /api/cron/tick):
 *  1. keeps the free Supabase project awake,
 *  2. syncs Xero every N hours (call budget),
 *  3. sends the morning briefing push at the chosen UK hour,
 *  4. sends deadline reminders (push + Microsoft To Do task) at 30/7/1 days.
 * Each step is independent and recorded so it runs once.
 */

function ukHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(d));
}

async function once(ctx: Ctx, key: string, channel: string, fn: () => Promise<unknown>) {
  const { data } = await ctx.sb.from("reminders_sent").select("reminder_key").eq("owner_id", ctx.ownerId).eq("reminder_key", key).eq("channel", channel).maybeSingle();
  if (data) return false;
  await fn();
  await ctx.sb.from("reminders_sent").insert({ owner_id: ctx.ownerId, reminder_key: key, channel });
  return true;
}

export async function runTick(opts: { force?: boolean } = {}) {
  const admin = supabaseAdmin();
  if (!admin) return { ok: false, error: "SUPABASE_SECRET_KEY is not set; scheduled jobs are disabled." };
  const ownerId = await ownerUserId(admin);
  if (!ownerId) return { ok: false, error: "Owner account not found." };
  const ctx: Ctx = { sb: admin, ownerId, actor: { source: "cron" } };
  const prefs = await getPrefs(ctx);
  const today = todayUk();
  const hour = ukHour();
  const report: Record<string, unknown> = { today, hour };

  // 1. Keep-alive is implicit (queries above). 2. Xero sync.
  try {
    const xero = await connectionStatus(ctx, "xero");
    if (xero?.status === "active") {
      const last = await lastSync(ctx);
      const due = opts.force || !last?.last_success_at || Date.now() - Date.parse(last.last_success_at) > prefs.xeroSyncHours * 3_600_000 || (last.last_error && last.last_run_at && Date.now() - Date.parse(last.last_run_at) > 3_600_000);
      report.xero = due ? await syncXero(ctx, { budgetMs: 20_000 }) : "not due";
    } else report.xero = "not connected";
  } catch (e) {
    report.xero = { error: e instanceof Error ? e.message : "failed" };
  }

  // 2b. Hevy (every 6 hours, if connected).
  try {
    const { data: hevy } = await ctx.sb.from("integration_connections").select("status, updated_at").eq("owner_id", ownerId).eq("provider", "hevy").maybeSingle();
    if (hevy?.status === "active" && (opts.force || hour % 6 === 0)) report.hevy = await syncHevy(ctx);
  } catch (e) {
    report.hevy = { error: e instanceof Error ? e.message : "failed" };
  }

  // 3. Morning briefing push.
  try {
    if (hour === prefs.briefingHour || opts.force) {
      report.briefing = await once(ctx, `briefing:${today}`, "push", async () => {
        const b = await gatherBriefing(ctx);
        await sendPush(ctx, { title: `Jarvis · ${formatUkDate(today)}`, body: b.headline.slice(0, 220), url: "/", tag: "briefing" });
      });
    }
  } catch (e) {
    report.briefing = { error: e instanceof Error ? e.message : "failed" };
  }

  // 4. Deadline reminders (from 08:00 UK).
  try {
    if (hour >= 8 || opts.force) {
      const deadlines = await upcomingDeadlines(ctx, { days: Math.max(...prefs.reminderLeadDays, 1) + 1 });
      const ms = prefs.deadlineTasks ? await connectionStatus(ctx, "microsoft") : null;
      const graph = ms?.status === "active" ? new GraphClient(ctx) : null;
      let sent = 0;
      for (const d of deadlines) {
        const lead = prefs.reminderLeadDays.find((n) => d.daysAway === n) ?? (d.daysAway === 0 ? 0 : null);
        if (lead === null || lead === undefined) continue;
        const did = await once(ctx, `deadline:${d.key}:${lead}`, "push", () =>
          sendPush(ctx, { title: lead === 0 ? "Due today" : `Due in ${lead} day${lead === 1 ? "" : "s"}`, body: `${d.title} — ${formatUkDate(d.due)}${d.verified ? "" : " (unverified rule)"}`, url: "/tax", tag: d.key }),
        );
        if (did) sent++;
        if (graph && lead === Math.max(...prefs.reminderLeadDays)) {
          await once(ctx, `deadline:${d.key}`, "todo", () => graph.addTask({ title: d.title, due: d.due, notes: `Added by Jarvis. ${d.note ?? ""}`.trim(), reminder: d.due, importance: "high" }));
        }
      }
      report.reminders = sent;
    }
  } catch (e) {
    report.reminders = { error: e instanceof Error ? e.message : "failed" };
  }

  await audit(ctx, "cron.tick", null, { hour, xero: typeof report.xero === "string" ? report.xero : "ran" }).catch(() => {});
  return { ok: true, ...report };
}

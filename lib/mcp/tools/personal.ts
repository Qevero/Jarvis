import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { syncHevy } from "@/lib/hevy/client";
import { healthSummary, liftProgress, loadHealth, logHealth, markMessagesSeen, missedMessages, weatherFor, weightSeries } from "@/lib/services/personal";
import { geocode, getForecast } from "@/lib/weather";
import { run } from "../util";

/** Personal assistant tools: weather, health & nutrition, training, missed messages. */
export function registerPersonalTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "get_weather",
    { title: "Weather", description: "Forecast (UK units) for Jasper's home location, or any place by name. Up to 7 days.", inputSchema: { place: z.string().optional().describe("e.g. 'London' — omit for home"), days: z.number().int().min(1).max(7).optional() }, annotations: { readOnlyHint: true, openWorldHint: true } },
    async ({ place, days }) =>
      run(async () => {
        if (!place) return weatherFor(ctx, days ?? 3);
        const g = await geocode(place);
        if (!g) throw new Error(`Couldn't find "${place}".`);
        return getForecast(g.lat, g.lon, g.name, days ?? 3);
      }),
  );

  server.registerTool(
    "get_health_summary",
    {
      title: "Health summary",
      description: "Jasper's nutrition (from MyFitnessPal via Apple Health: calories, protein, macros vs his targets), weight trend (7-day average, kg/week, distance to goal), training (sessions vs target, last workout, weekly volume) and recent lift PRs (Hevy). Personal data — use it for coaching and accountability, never in business outputs.",
      inputSchema: { days: z.number().int().min(1).max(90).optional().describe("Period, default 7") },
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => run(async () => healthSummary(await loadHealth(ctx, Math.max(90, days ?? 7)), days ?? 7)),
  );

  server.registerTool(
    "get_weight_trend",
    { title: "Weight trend", description: "Daily weigh-ins with a 7-day moving average and rate of change.", inputSchema: { days: z.number().int().min(7).max(365).optional() }, annotations: { readOnlyHint: true } },
    async ({ days }) => run(async () => weightSeries(ctx, days ?? 90)),
  );

  server.registerTool(
    "get_workouts",
    { title: "Workouts", description: "Recent workouts (Hevy and Apple Health) with exercises, sets, weights and reps.", inputSchema: { days: z.number().int().min(1).max(180).optional(), include_sets: z.boolean().optional() }, annotations: { readOnlyHint: true } },
    async ({ days, include_sets }) =>
      run(async () => {
        const d = await loadHealth(ctx, days ?? 14);
        const from = new Date(Date.now() - (days ?? 14) * 86_400_000).toISOString();
        return d.workouts
          .filter((w) => w.started_at >= from)
          .reverse()
          .map((w) => ({ title: w.title, source: w.source, started_at: w.started_at, duration_min: w.duration_min, volume_kg: w.volume_kg, sets: w.set_count, exercises: include_sets ? w.exercises : w.exercises.map((e) => `${e.title} ×${e.sets.length}`) }));
      }),
  );

  server.registerTool(
    "get_lift_progress",
    { title: "Lift progress", description: "Best estimated 1RM per lift, or the session-by-session history of one lift (e.g. 'Bench Press').", inputSchema: { exercise: z.string().optional() }, annotations: { readOnlyHint: true } },
    async ({ exercise }) => run(async () => liftProgress(ctx, exercise)),
  );

  server.registerTool(
    "log_health",
    { title: "Log weight / food", description: "Manually log a weigh-in (kg, lb or st), calories or protein for a day — e.g. when Jasper says 'I weighed 82.4 this morning'. MyFitnessPal data normally arrives automatically.", inputSchema: { day: z.string().optional().describe("DD/MM/YYYY, default today"), weight: z.string().optional().describe("e.g. '82.4 kg' or '181 lb'"), calories: z.number().optional(), protein: z.number().optional() } },
    async (a) => run(async () => logHealth(ctx, { day: a.day, weight: a.weight ?? null, calories: a.calories ?? null, protein: a.protein ?? null })),
  );

  server.registerTool(
    "sync_hevy",
    { title: "Refresh from Hevy", description: "Pull the latest workouts from Hevy now.", inputSchema: {} },
    async () => run(async () => syncHevy(ctx)),
  );

  server.registerTool(
    "get_missed_messages",
    {
      title: "Missed messages",
      description: "Messages Jasper hasn't seen yet from WhatsApp, iMessage and SMS (forwarded from his own Mac/iPhone), grouped by chat. Summarise who needs a reply and anything urgent; quote sparingly. Then offer to mark them seen. Never send replies — Jarvis can't.",
      inputSchema: { hours: z.number().int().min(1).max(336).optional().describe("Look-back, default 24"), source: z.enum(["whatsapp", "imessage", "sms"]).optional(), include_seen: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      run(async () => {
        const r = await missedMessages(ctx, { hours: a.hours ?? 24, source: a.source, includeSeen: a.include_seen });
        return r.total ? r : { total: 0, note: "No unseen messages. If you expected some, check the Mac bridge or iPhone automation is running (Jarvis → Messages)." };
      }),
  );

  server.registerTool(
    "mark_messages_seen",
    { title: "Mark messages seen", description: "Mark forwarded messages as seen in Jarvis (pass ids from get_missed_messages, or none for all). This doesn't change anything in WhatsApp or Messages.", inputSchema: { ids: z.array(z.string().uuid()).optional() } },
    async ({ ids }) => run(async () => markMessagesSeen(ctx, ids)),
  );
}

import { ingest, readJson } from "@/lib/ingest";
import { parseMeasure } from "@/lib/health/normalise";

export const dynamic = "force-dynamic";

/** Workouts from Apple Health via a Shortcut (title, start, duration, energy). Hevy detail comes from the Hevy API. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { workouts?: unknown }).workouts) ? (body as { workouts: unknown[] }).workouts : [body];
  const rows = list
    .map((w) => w as Record<string, unknown>)
    .filter((w) => w && (w.started_at || w.start))
    .map((w) => {
      const start = new Date(String(w.started_at ?? w.start));
      const mins = parseMeasure(w.duration_min ?? w.duration);
      return {
        source: "apple_health",
        workout_id: String(w.workout_id ?? w.id ?? `${start.toISOString().slice(0, 16)}|${w.title ?? w.type ?? "Workout"}`),
        title: String(w.title ?? w.type ?? "Workout").slice(0, 120),
        started_at: start.toISOString(),
        ended_at: mins ? new Date(start.getTime() + mins * 60_000).toISOString() : null,
        duration_min: mins,
        active_kcal: parseMeasure(w.active_kcal ?? w.energy ?? w.calories),
        volume_kg: null,
        set_count: null,
        exercises: [],
      };
    })
    .filter((w) => !Number.isNaN(Date.parse(w.started_at)))
    .slice(0, 200);
  return ingest(request, "workouts", rows);
}

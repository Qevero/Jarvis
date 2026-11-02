import { workoutVolume, type ExerciseRow } from "@/lib/health/analytics";

/** Maps Hevy API workouts (api.hevyapp.com/v1) to Jarvis rows. Tolerant of missing fields. */

type J = Record<string, unknown>;

export function mapHevyWorkout(w: J) {
  const exercises: ExerciseRow[] = (Array.isArray(w.exercises) ? (w.exercises as J[]) : []).map((e) => ({
    title: String(e.title ?? e.name ?? "Exercise"),
    sets: (Array.isArray(e.sets) ? (e.sets as J[]) : []).map((s) => ({
      type: typeof s.type === "string" ? s.type : "normal",
      weight_kg: s.weight_kg === null || s.weight_kg === undefined ? null : Number(s.weight_kg),
      reps: s.reps === null || s.reps === undefined ? null : Number(s.reps),
      distance_m: s.distance_meters === null || s.distance_meters === undefined ? null : Number(s.distance_meters),
      duration_s: s.duration_seconds === null || s.duration_seconds === undefined ? null : Number(s.duration_seconds),
    })),
  }));
  const start = String(w.start_time ?? w.created_at ?? "");
  const end = w.end_time ? String(w.end_time) : null;
  const { volumeKg, sets } = workoutVolume(exercises);
  return {
    source: "hevy" as const,
    workout_id: String(w.id),
    title: typeof w.title === "string" ? w.title : "Workout",
    started_at: new Date(start).toISOString(),
    ended_at: end ? new Date(end).toISOString() : null,
    duration_min: end ? Math.round(((Date.parse(end) - Date.parse(start)) / 60000) * 10) / 10 : null,
    volume_kg: volumeKg,
    set_count: sets,
    active_kcal: null,
    exercises,
    notes: typeof w.description === "string" && w.description ? w.description.slice(0, 2000) : null,
  };
}

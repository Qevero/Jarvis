import { describe, expect, it } from "vitest";
import { e1rm, liftHistory, liftRecords, loggingStreak, nutritionSummary, trainingWeeks, weightChange, weightTrend, workoutVolume, type DayRow, type WorkoutRow } from "@/lib/health/analytics";
import { normaliseHealthPayload, parseMeasure } from "@/lib/health/normalise";
import { mapHevyWorkout } from "@/lib/hevy/map";
import { groupByChat, normaliseMessages } from "@/lib/messages/normalise";
import { describeWeatherCode, parseForecast, weatherSentence } from "@/lib/weather";

const day = (d: string, p: Partial<DayRow> = {}): DayRow => ({ day: d, energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, weight_kg: null, steps: null, active_kcal: null, sleep_hours: null, ...p });

describe("health ingest normalisation", () => {
  it("parses Shortcut values with units", () => {
    expect(parseMeasure("2,104 kcal")).toBe(2104);
    expect(parseMeasure("82.4 kg")).toBe(82.4);
    expect(parseMeasure("176 lb", { lbToKg: true })).toBe(79.83);
    expect(parseMeasure("12 st", { lbToKg: true })).toBe(76.2);
    expect(parseMeasure("2.5 L", { litresToMl: true })).toBe(2500);
    expect(parseMeasure("")).toBeNull();
    expect(parseMeasure("n/a")).toBeNull();
  });
  it("accepts friendly keys and UK dates, drops nonsense", () => {
    const rows = normaliseHealthPayload({ Date: "02/11/2026", Calories: "2104 kcal", Protein: "151.6 g", Weight: "82.4 kg", Steps: "9,812", "Body fat": "0.18", "Resting heart rate": 999 });
    expect(rows).toEqual([{ day: "2026-11-02", source: "apple_health", energy_kcal: 2104, protein_g: 151.6, weight_kg: 82.4, steps: 9812, body_fat_pct: 18 }]);
    expect(normaliseHealthPayload({ calories: 2000 })).toEqual([]);
    expect(normaliseHealthPayload({ days: [{ day: "2026-11-01", weight: "80" }, { day: "2026-11-02" }] })).toHaveLength(1);
  });
});

describe("health analytics", () => {
  const days = [
    day("2026-10-20", { weight_kg: 84, energy_kcal: 2500, protein_g: 120 }),
    day("2026-10-27", { weight_kg: 83, energy_kcal: 2200, protein_g: 160 }),
    day("2026-10-31", { energy_kcal: 2050, protein_g: 170 }),
    day("2026-11-01", { weight_kg: 82, energy_kcal: 1980, protein_g: 150 }),
    day("2026-11-02", { energy_kcal: 2100, protein_g: 140 }),
  ];
  it("tracks a 7-day weight average and weekly rate", () => {
    expect(weightTrend(days).map((p) => p.avg)).toEqual([84, 83, 82.5]);
    const c = weightChange(days, "2026-11-02")!;
    expect(c).toMatchObject({ latestKg: 82, changeKg: -1.5, perWeekKg: -0.9, staleDays: 1 });
  });
  it("summarises nutrition against targets", () => {
    const n = nutritionSummary(days, "2026-11-02", 7, { kcal: 2100, protein: 150 });
    expect(n).toMatchObject({ daysLogged: 4, avgKcal: 2083, avgProtein: 155, daysWithinKcalTarget: 4, proteinTargetHitDays: 3 });
    expect(loggingStreak(days, "2026-11-02")).toBe(3);
  });
});

describe("training", () => {
  const w = (id: string, started: string, sets: { kg: number; reps: number; type?: string }[], title = "Bench Press (Barbell)"): WorkoutRow => {
    const exercises = [{ title, sets: sets.map((s) => ({ weight_kg: s.kg, reps: s.reps, type: s.type ?? "normal" })) }];
    const v = workoutVolume(exercises);
    return { workout_id: id, source: "hevy", title: "Push", started_at: started, duration_min: 60, volume_kg: v.volumeKg, set_count: v.sets, exercises };
  };
  const workouts = [w("1", "2026-10-20T18:00:00Z", [{ kg: 60, reps: 10, type: "warmup" }, { kg: 80, reps: 8 }]), w("2", "2026-10-27T18:00:00Z", [{ kg: 85, reps: 6 }]), w("3", "2026-11-01T18:00:00Z", [{ kg: 90, reps: 5 }, { kg: 80, reps: 8 }])];
  it("computes e1RM, volume (no warm-ups) and weekly load", () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(80, 8)).toBe(101.3);
    expect(workouts[0]).toMatchObject({ volume_kg: 640, set_count: 1 });
    expect(trainingWeeks(workouts, "2026-11-02", 3).map((x) => x.sessions)).toEqual([1, 2, 0]); // 01/11 is a Sunday
  });
  it("finds best lifts and recent PRs", () => {
    const r = liftRecords(workouts, "2026-11-02");
    expect(r.best[0]).toMatchObject({ exercise: "Bench Press (Barbell)", e1rm: 105, weightKg: 90, reps: 5 });
    expect(r.recentPRs.map((p) => p.day)).toEqual(["2026-11-01", "2026-10-27"]);
    expect(liftHistory(workouts, "bench").map((h) => h.e1rm)).toEqual([101.3, 102, 105]);
  });
  it("maps Hevy workouts", () => {
    const m = mapHevyWorkout({ id: "abc", title: "Legs", start_time: "2026-11-01T09:00:00Z", end_time: "2026-11-01T10:15:00Z", exercises: [{ title: "Squat (Barbell)", sets: [{ type: "warmup", weight_kg: 60, reps: 5 }, { type: "normal", weight_kg: 120, reps: 5 }] }] });
    expect(m).toMatchObject({ source: "hevy", workout_id: "abc", title: "Legs", duration_min: 75, volume_kg: 600, set_count: 1 });
  });
});

describe("weather", () => {
  it("describes WMO codes and builds a briefing sentence", () => {
    expect(describeWeatherCode(61)).toBe("Light rain");
    const w = parseForecast("Norwich", { current: { temperature_2m: 9.4, weather_code: 3, wind_speed_10m: 20 }, daily: { time: ["2026-11-02"], weather_code: [63], temperature_2m_max: [11.6], temperature_2m_min: [5.2], precipitation_probability_max: [70], wind_speed_10m_max: [55], sunrise: ["2026-11-02T07:01"], sunset: ["2026-11-02T16:25"] } });
    expect(w.current).toEqual({ tempC: 9, summary: "Overcast", windMph: 12 });
    expect(w.days[0]).toMatchObject({ maxC: 12, minC: 5, sunrise: "07:01", windMaxMph: 34 });
    expect(weatherSentence(w)).toBe("Norwich: rain, 5–12°C. 70% chance of rain — take a coat. Windy, gusts around 34 mph.");
  });
});

describe("messages", () => {
  const now = new Date("2026-11-02T08:00:00Z");
  it("normalises Shortcut and bridge payloads with stable ids", () => {
    const a = normaliseMessages({ sender: "Mum", text: "Call me when you can" }, now);
    const b = normaliseMessages({ sender: "Mum", text: "Call me when you can" }, now);
    expect(a[0].external_id).toBe(b[0].external_id);
    expect(a[0]).toMatchObject({ source: "imessage", chat_name: "Mum", sent_at: "2026-11-02T08:00:00.000Z" });
    const batch = normaliseMessages({ messages: [{ source: "whatsapp", external_id: "w1", chat: "5-a-side", sender: "Dan", is_group: true, sent_at: "2026-11-02T07:30:00Z", text: "Game moved to 7pm" }, { source: "whatsapp", text: "" }] }, now);
    expect(batch).toEqual([{ source: "whatsapp", external_id: "w1", chat_name: "5-a-side", sender: "Dan", is_group: true, sent_at: "2026-11-02T07:30:00.000Z", text: "Game moved to 7pm" }]);
  });
  it("groups by chat, newest first", () => {
    const g = groupByChat([
      { source: "whatsapp", chat_name: "5-a-side", sender: "Dan", sent_at: "2026-11-02T07:30:00Z", text: "a" },
      { source: "imessage", chat_name: "Mum", sender: "Mum", sent_at: "2026-11-02T07:45:00Z", text: "b" },
      { source: "whatsapp", chat_name: "5-a-side", sender: "Sam", sent_at: "2026-11-02T07:50:00Z", text: "c" },
    ]);
    expect(g.map((x) => [x.chat, x.count])).toEqual([["5-a-side", 2], ["Mum", 1]]);
  });
});

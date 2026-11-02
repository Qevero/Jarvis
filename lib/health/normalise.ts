import { parseDate } from "@/lib/dates";

/**
 * Normalises health data sent by an iPhone Shortcut (from Apple Health, which
 * MyFitnessPal and Hevy write to). Shortcuts send numbers as strings, often
 * with units ("2,104 kcal", "82.4 kg", "176 lb") — this cleans them up.
 */

export type HealthDay = {
  day: string;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fibre_g?: number | null;
  water_ml?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  steps?: number | null;
  active_kcal?: number | null;
  exercise_min?: number | null;
  resting_hr?: number | null;
  sleep_hours?: number | null;
  source?: string;
};

const FIELDS: (keyof Omit<HealthDay, "day" | "source">)[] = ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fibre_g", "water_ml", "weight_kg", "body_fat_pct", "steps", "active_kcal", "exercise_min", "resting_hr", "sleep_hours"];

/** Friendly aliases a Shortcut might use. */
const ALIASES: Record<string, keyof HealthDay> = {
  date: "day", calories: "energy_kcal", kcal: "energy_kcal", energy: "energy_kcal", dietary_energy: "energy_kcal",
  protein: "protein_g", carbs: "carbs_g", carbohydrates: "carbs_g", fat: "fat_g", fibre: "fibre_g", fiber: "fibre_g", water: "water_ml",
  weight: "weight_kg", body_fat: "body_fat_pct", bodyfat: "body_fat_pct", active_energy: "active_kcal", exercise: "exercise_min",
  resting_heart_rate: "resting_hr", sleep: "sleep_hours",
};

const RANGES: Partial<Record<keyof HealthDay, [number, number]>> = {
  energy_kcal: [0, 15000], protein_g: [0, 1000], carbs_g: [0, 2000], fat_g: [0, 1000], fibre_g: [0, 300], water_ml: [0, 20000],
  weight_kg: [20, 400], body_fat_pct: [1, 80], steps: [0, 200000], active_kcal: [0, 10000], exercise_min: [0, 1440], resting_hr: [20, 250], sleep_hours: [0, 24],
};

/** "2,104 kcal" → 2104; "176 lb" → 79.83 (when lbToKg); "" → null. */
export function parseMeasure(v: unknown, opts: { lbToKg?: boolean; litresToMl?: boolean } = {}): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().toLowerCase();
  const m = /^(-?[\d,]*\.?\d+)\s*([a-z%]*)/.exec(s.replace(/\s+/g, " "));
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const unit = m[2];
  if (!Number.isFinite(n)) return null;
  if (opts.lbToKg && (unit === "lb" || unit === "lbs")) n = n * 0.45359237;
  if (opts.lbToKg && unit === "st") n = n * 6.35029318;
  if (opts.litresToMl && (unit === "l" || unit === "litre" || unit === "litres")) n = n * 1000;
  return Math.round(n * 100) / 100;
}

export function normaliseHealthPayload(body: unknown): HealthDay[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { days?: unknown }).days) ? (body as { days: unknown[] }).days : [body];
  const out: HealthDay[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const src: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = k.trim().toLowerCase().replace(/[\s-]+/g, "_");
      src[ALIASES[key] ?? key] = v;
    }
    const day = parseDate(String(src.day ?? "").slice(0, 10)) ?? parseDate(String(src.day ?? ""));
    if (!day) continue;
    const row: HealthDay = { day, source: typeof src.source === "string" ? src.source.slice(0, 40) : "apple_health" };
    for (const f of FIELDS) {
      let n = parseMeasure(src[f], { lbToKg: f === "weight_kg", litresToMl: f === "water_ml" });
      if (n !== null && f === "body_fat_pct" && n > 0 && n < 1) n = Math.round(n * 10000) / 100; // 0.18 → 18%
      if (n !== null && f === "steps") n = Math.round(n);
      const range = RANGES[f];
      if (n !== null && range && (n < range[0] || n > range[1])) n = null;
      if (n !== null) (row as Record<string, unknown>)[f] = n;
    }
    if (Object.keys(row).length > 2) out.push(row);
  }
  return out.slice(0, 400);
}

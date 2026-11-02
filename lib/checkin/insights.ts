/**
 * Daily check-in insights: simple, explainable comparisons (no AI). Only
 * reported when each side has at least 3 days, so it isn't reading tea leaves.
 */

export type Checkin = { day: string; mood: number | null; energy: number | null; sleep: number | null; stress: number | null };

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const vals = (cs: Checkin[], k: keyof Omit<Checkin, "day">) => cs.map((c) => c[k]).filter((v): v is number => typeof v === "number");

export function checkinAverages(cs: Checkin[]) {
  return { days: cs.length, mood: avg(vals(cs, "mood")), energy: avg(vals(cs, "energy")), sleep: avg(vals(cs, "sleep")), stress: avg(vals(cs, "stress")) };
}

export function checkinInsights(cs: Checkin[], trainingDays: Set<string>, minEach = 3): string[] {
  const out: string[] = [];
  const compare = (label: string, a: Checkin[], b: Checkin[], key: "mood" | "energy", aName: string, bName: string) => {
    const va = vals(a, key), vb = vals(b, key);
    if (va.length < minEach || vb.length < minEach) return;
    const ma = avg(va)!, mb = avg(vb)!;
    if (Math.abs(ma - mb) >= 0.5) out.push(`${label}: ${key} averages ${ma}/5 ${aName} vs ${mb}/5 ${bName}.`);
  };
  compare("Training", cs.filter((c) => trainingDays.has(c.day)), cs.filter((c) => !trainingDays.has(c.day)), "mood", "on training days", "on rest days");
  compare("Training", cs.filter((c) => trainingDays.has(c.day)), cs.filter((c) => !trainingDays.has(c.day)), "energy", "on training days", "on rest days");
  compare("Sleep", cs.filter((c) => (c.sleep ?? 0) >= 4), cs.filter((c) => c.sleep !== null && c.sleep <= 2), "energy", "after good sleep", "after poor sleep");
  compare("Stress", cs.filter((c) => (c.stress ?? 0) >= 4), cs.filter((c) => c.stress !== null && c.stress <= 2), "mood", "on high-stress days", "on calm days");
  return out;
}

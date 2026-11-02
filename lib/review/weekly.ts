import { formatGbpFromPence, formatUkDate } from "@/lib/dates";

/** Sunday "week in review": business and personal, templated (no AI). Claude can discuss it. */

export type WeeklyInput = {
  weekStart: string;
  weekEnd: string;
  revenue?: { thisWeek: number; lastWeek: number; invoicesRaised: number; invoicesPaid: number; overdue: number } | null;
  proposals?: { sent: number; won: number; lost: number } | null;
  deadlines?: { title: string; due: string; daysAway: number }[] | null;
  training?: { sessions: number; lastWeekSessions: number; volumeKg: number; lastWeekVolumeKg: number; prs: string[] } | null;
  weight?: { changeKg: number | null; avgKg: number | null } | null;
  nutrition?: { avgKcal: number | null; avgProtein: number | null; daysLogged: number; kcalTarget: number | null; proteinTarget: number | null } | null;
  checkins?: { days: number; mood: number | null; energy: number | null; sleep: number | null; stress: number | null } | null;
  insights?: string[];
  journal?: { entries: number; themes: string[] } | null;
  messages?: { unseen: number } | null;
};

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));
const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / Math.abs(b)) * 100)}%` : "—");

export function composeWeeklyReview(w: WeeklyInput) {
  const sections: { id: string; title: string; lines: string[] }[] = [];
  const wins: string[] = [];
  const watch: string[] = [];

  if (w.revenue) {
    const r = w.revenue;
    sections.push({ id: "business", title: "Business", lines: [`Revenue invoiced: ${gbp(r.thisWeek)} (${pct(r.thisWeek, r.lastWeek)} vs last week).`, `${r.invoicesRaised} invoice${r.invoicesRaised === 1 ? "" : "s"} raised, ${r.invoicesPaid} paid.`, r.overdue ? `${gbp(r.overdue)} overdue.` : "Nothing overdue."] });
    if (r.thisWeek > r.lastWeek && r.thisWeek > 0) wins.push("Revenue up on last week");
    if (r.overdue > 0) watch.push(`${gbp(r.overdue)} overdue — chase on Monday`);
  }
  if (w.proposals && (w.proposals.sent || w.proposals.won || w.proposals.lost)) {
    sections.push({ id: "sales", title: "Sales", lines: [`Proposals: ${w.proposals.sent} sent, ${w.proposals.won} won, ${w.proposals.lost} lost.`] });
    if (w.proposals.won) wins.push(`${w.proposals.won} proposal${w.proposals.won > 1 ? "s" : ""} won`);
  }
  if (w.training) {
    const t = w.training;
    sections.push({ id: "training", title: "Training", lines: [`${t.sessions} session${t.sessions === 1 ? "" : "s"} (last week ${t.lastWeekSessions}).`, `Volume ${Math.round(t.volumeKg).toLocaleString("en-GB")} kg (${pct(t.volumeKg, t.lastWeekVolumeKg)}).`, ...t.prs.map((p) => `PR: ${p}`)] });
    if (t.prs.length) wins.push(`${t.prs.length} personal record${t.prs.length > 1 ? "s" : ""}`);
    if (t.sessions < t.lastWeekSessions) watch.push("Fewer gym sessions than last week");
  }
  if (w.nutrition || w.weight) {
    const lines: string[] = [];
    if (w.nutrition) {
      const n = w.nutrition;
      lines.push(`Logged food ${n.daysLogged}/7 days${n.avgKcal !== null ? ` · ${n.avgKcal.toLocaleString("en-GB")} kcal avg${n.kcalTarget ? ` (target ${n.kcalTarget.toLocaleString("en-GB")})` : ""}` : ""}${n.avgProtein !== null ? ` · ${n.avgProtein} g protein${n.proteinTarget ? ` (target ${n.proteinTarget})` : ""}` : ""}.`);
      if (n.proteinTarget && n.avgProtein !== null && n.avgProtein >= n.proteinTarget) wins.push("Protein target hit on average");
      if (n.daysLogged < 5) watch.push("Food logging slipped");
    }
    if (w.weight?.avgKg) lines.push(`Weight ${w.weight.avgKg} kg (7-day avg)${w.weight.changeKg !== null ? `, ${w.weight.changeKg > 0 ? "+" : ""}${w.weight.changeKg} kg this week` : ""}.`);
    sections.push({ id: "health", title: "Nutrition & weight", lines });
  }
  if (w.checkins && w.checkins.days) {
    const c = w.checkins;
    sections.push({ id: "wellbeing", title: "How you felt", lines: [`${c.days} check-in${c.days === 1 ? "" : "s"}: mood ${c.mood ?? "—"}/5, energy ${c.energy ?? "—"}/5, sleep ${c.sleep ?? "—"}/5, stress ${c.stress ?? "—"}/5.`, ...(w.insights ?? [])] });
    if ((c.stress ?? 0) >= 4) watch.push("Stress has been high");
  }
  if (w.journal) sections.push({ id: "journal", title: "On your mind", lines: [w.journal.entries ? `${w.journal.entries} journal entr${w.journal.entries === 1 ? "y" : "ies"}${w.journal.themes.length ? ` — themes: ${w.journal.themes.slice(0, 5).join(", ")}` : ""}.` : "No journal entries this week."] });
  if (w.deadlines?.length) sections.push({ id: "ahead", title: "Coming up (14 days)", lines: w.deadlines.slice(0, 6).map((d) => `${formatUkDate(d.due)} — ${d.title}`) });

  const prompts = ["What was the best thing that happened this week?", "What will make next week a win?", "What should you stop, start or continue?"];
  const headline = wins.length ? `Wins: ${wins.slice(0, 3).join(", ")}.` : "A steady week.";
  const spoken = [`Here's your week, ${formatUkDate(w.weekStart)} to ${formatUkDate(w.weekEnd)}.`, headline, watch.length ? `Keep an eye on: ${watch.slice(0, 3).join("; ")}.` : ""].filter(Boolean).join(" ");
  return { headline, wins, watch, sections, prompts, spoken };
}

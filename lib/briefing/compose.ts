import { formatGbpFromPence, formatUkDate } from "@/lib/dates";

/**
 * Morning briefing composer: turns the day's data into short, speakable
 * sentences. Templated (no AI); Claude can elaborate when asked.
 */

export type BriefingInput = {
  today: string;
  weekday: string;
  calendar?: { start: string; subject: string; location?: string | null; allDay?: boolean }[] | null;
  tasksDue?: { title: string; due: string | null; overdue: boolean }[] | null;
  flags?: { severity: string; title: string }[] | null;
  deadlines?: { title: string; due: string; daysAway: number; verified: boolean }[] | null;
  cash?: { total: number; accounts: { account: string; closing: number }[] } | null;
  setAside?: { total: number } | null;
  revenue?: { monthToDate: number; lastMonth: number; projected: number | null } | null;
  debtors?: { overdue: number; count: number } | null;
  crm?: { openTasksOverdue: number; quotedPipeline: number; tendersClosingSoon: number } | null;
  journalPrompt?: string | null;
  weather?: { sentence: string; days: { date: string; summary: string; maxC: number; minC: number; rainChancePct: number | null }[] } | null;
  health?: { yesterdayKcal: number | null; kcalTarget: number | null; yesterdayProtein: number | null; proteinTarget: number | null; weightAvg: number | null; perWeekKg: number | null; sessionsThisWeek: number; sessionsTarget: number | null; lastWorkout: string | null; prs: string[] } | null;
  messages?: { unseen: number; chats: number; bySource: Record<string, number> } | null;
};

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function composeBriefing(b: BriefingInput) {
  const sections: { id: string; title: string; lines: string[] }[] = [];
  const spoken: string[] = [`Good morning Jasper. It's ${b.weekday} ${formatUkDate(b.today)}.`];

  if (b.weather) {
    sections.push({ id: "weather", title: "Weather", lines: [b.weather.sentence, ...b.weather.days.slice(1, 3).map((d) => `${formatUkDate(d.date)}: ${d.summary.toLowerCase()}, ${d.minC}–${d.maxC}°C${d.rainChancePct !== null ? `, ${d.rainChancePct}% rain` : ""}`)] });
    spoken.push(b.weather.sentence);
  }

  if (b.messages && b.messages.unseen > 0) {
    const parts = Object.entries(b.messages.bySource).map(([k, n]) => `${n} ${{ whatsapp: "WhatsApp", imessage: "iMessage", sms: "SMS" }[k] ?? k}`);
    sections.push({ id: "messages", title: "Missed messages", lines: [`${plural(b.messages.unseen, "message")} in ${plural(b.messages.chats, "chat")} (${parts.join(", ")}). Ask Jarvis to summarise them.`] });
    spoken.push(`You have ${plural(b.messages.unseen, "unread message")} across ${plural(b.messages.chats, "chat")}.`);
  }

  if (b.calendar) {
    const lines = b.calendar.map((e) => `${e.allDay ? "All day" : e.start.slice(11, 16)} — ${e.subject}${e.location ? ` (${e.location})` : ""}`);
    sections.push({ id: "calendar", title: "Today's calendar", lines: lines.length ? lines : ["Nothing in the diary."] });
    spoken.push(lines.length ? `You have ${plural(lines.length, "event")} today, starting with ${b.calendar[0].subject}${b.calendar[0].allDay ? "" : ` at ${b.calendar[0].start.slice(11, 16)}`}.` : "Your diary is clear today.");
  }

  if (b.tasksDue) {
    const overdue = b.tasksDue.filter((t) => t.overdue);
    const lines = b.tasksDue.slice(0, 8).map((t) => `${t.overdue ? "Overdue: " : ""}${t.title}${t.due ? ` (${formatUkDate(t.due)})` : ""}`);
    sections.push({ id: "tasks", title: "Tasks due", lines: lines.length ? lines : ["No tasks due today."] });
    if (b.tasksDue.length) spoken.push(`${plural(b.tasksDue.length, "task")} due${overdue.length ? `, ${overdue.length} overdue` : ""}.`);
  }

  if (b.flags) {
    const important = b.flags.filter((f) => f.severity !== "low");
    sections.push({ id: "attention", title: "Needs attention", lines: b.flags.length ? b.flags.slice(0, 6).map((f) => f.title) : ["Nothing flagged."] });
    if (important.length) spoken.push(`Needs attention: ${important.slice(0, 3).map((f) => f.title).join("; ")}.`);
  }

  if (b.revenue || b.debtors || b.cash || b.setAside) {
    const lines: string[] = [];
    if (b.revenue) {
      lines.push(`Revenue this month so far: ${gbp(b.revenue.monthToDate)}${b.revenue.projected !== null ? ` (on pace for ${gbp(b.revenue.projected)})` : ""}. Last month: ${gbp(b.revenue.lastMonth)}.`);
      spoken.push(`Revenue this month is ${gbp(b.revenue.monthToDate)} so far.`);
    }
    if (b.debtors && b.debtors.count) {
      lines.push(`${plural(b.debtors.count, "invoice")} overdue, ${gbp(b.debtors.overdue)} owed.`);
      spoken.push(`${gbp(b.debtors.overdue)} is overdue from customers.`);
    }
    if (b.cash) {
      lines.push(`Cash in the bank: ${gbp(b.cash.total)}.`);
      spoken.push(`Cash in the bank is ${gbp(b.cash.total)}.`);
    }
    if (b.setAside) {
      lines.push(`Set aside for tax: ${gbp(b.setAside.total)} (estimate).`);
      if (b.cash) lines.push(`Free cash after tax set-aside: ${gbp(b.cash.total - b.setAside.total)}.`);
    }
    sections.push({ id: "money", title: "Money", lines });
  }

  if (b.deadlines) {
    const soon = b.deadlines.filter((d) => d.daysAway <= 30);
    sections.push({
      id: "deadlines",
      title: "Deadlines (next 30 days)",
      lines: soon.length ? soon.map((d) => `${formatUkDate(d.due)} — ${d.title}${d.daysAway < 0 ? " (OVERDUE)" : ` (${d.daysAway} days)`}${d.verified ? "" : " · unverified"}`) : ["No deadlines in the next 30 days."],
    });
    const next = soon[0];
    if (next) spoken.push(`Next deadline: ${next.title}, ${next.daysAway <= 0 ? "due today or overdue" : `in ${plural(next.daysAway, "day")}`}.`);
  }

  if (b.crm) {
    const lines = [
      `Quoted pipeline in the CRM: ${gbp(b.crm.quotedPipeline)} first-year value.`,
      b.crm.openTasksOverdue ? `${plural(b.crm.openTasksOverdue, "CRM task")} overdue.` : "No overdue CRM tasks.",
      b.crm.tendersClosingSoon ? `${plural(b.crm.tendersClosingSoon, "tender")} closing within 7 days.` : "",
    ].filter(Boolean);
    sections.push({ id: "crm", title: "Sales (CRM)", lines });
    if (b.crm.tendersClosingSoon) spoken.push(`${plural(b.crm.tendersClosingSoon, "tender")} closing this week.`);
  }

  if (b.health) {
    const h = b.health;
    const lines: string[] = [];
    if (h.yesterdayKcal !== null) lines.push(`Yesterday: ${Math.round(h.yesterdayKcal)} kcal${h.kcalTarget ? ` (target ${h.kcalTarget})` : ""}${h.yesterdayProtein !== null ? `, ${Math.round(h.yesterdayProtein)} g protein${h.proteinTarget ? ` (target ${h.proteinTarget})` : ""}` : ""}.`);
    if (h.weightAvg !== null) lines.push(`Weight (7-day average): ${h.weightAvg} kg${h.perWeekKg !== null ? `, ${h.perWeekKg > 0 ? "+" : ""}${h.perWeekKg} kg/week` : ""}.`);
    lines.push(`Training this week: ${plural(h.sessionsThisWeek, "session")}${h.sessionsTarget ? ` of ${h.sessionsTarget}` : ""}${h.lastWorkout ? ` · last: ${h.lastWorkout}` : ""}.`);
    for (const pr of h.prs) lines.push(`PR: ${pr}`);
    sections.push({ id: "health", title: "Health & training", lines });
    if (h.yesterdayKcal !== null) spoken.push(`Yesterday you logged ${Math.round(h.yesterdayKcal)} calories.`);
    if (h.prs.length) spoken.push(`Nice — ${h.prs.length === 1 ? "a new personal record" : `${h.prs.length} new personal records`} this fortnight.`);
  }

  if (b.journalPrompt) sections.push({ id: "journal", title: "Journal prompt", lines: [b.journalPrompt] });

  const headline = spoken.slice(1, 4).join(" ") || "All quiet.";
  return { headline, sections, spoken: spoken.join(" ") };
}

const PROMPTS = [
  "What's one thing that would make this week a win?",
  "Which client relationship needs the most attention right now, and why?",
  "What did you learn from the last proposal you sent?",
  "Where is time leaking out of the business?",
  "What would you stop doing if you could only work three days a week?",
  "Which revenue stream should grow fastest next quarter?",
  "What's a small experiment you could run on pricing?",
];

export function journalPromptFor(today: string): string {
  const d = Number(today.replace(/-/g, ""));
  return PROMPTS[d % PROMPTS.length];
}

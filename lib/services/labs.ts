import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit, UserError, type Ctx } from "@/lib/ctx";
import { todayUk } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { checkinAverages, checkinInsights, type Checkin } from "@/lib/checkin/insights";
import { composeWeeklyReview, type WeeklyInput } from "@/lib/review/weekly";
import { liftRecords, nutritionSummary, weightChange } from "@/lib/health/analytics";
import { NAV } from "@/lib/nav";
import { loadHealth, messageCounts } from "./personal";
import { upcomingDeadlines } from "./tax";

/** Labs: Inbox (captures), daily check-in, weekly review, global search. */

// ─── Inbox ────────────────────────────────────────────────────────────────
export type Capture = { id: string; kind: string; title: string | null; url: string | null; text: string | null; meta: Record<string, unknown>; status: string; created_at: string };

export async function listCaptures(ctx: Ctx, opts: { status?: "new" | "done" | "all"; limit?: number } = {}): Promise<Capture[]> {
  let q = ctx.sb.from("captures").select("id, kind, title, url, body_enc, meta, status, created_at").eq("owner_id", ctx.ownerId).order("created_at", { ascending: false }).limit(Math.min(opts.limit ?? 100, 300));
  if ((opts.status ?? "new") !== "all") q = q.eq("status", opts.status ?? "new");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const key = env.vaultKey();
  return (data ?? []).map((c) => {
    let text: string | null = null;
    if (c.body_enc) {
      try {
        text = decrypt(c.body_enc, key);
      } catch {
        text = "[unreadable]";
      }
    }
    return { id: c.id, kind: c.kind, title: c.title, url: c.url, text, meta: c.meta ?? {}, status: c.status, created_at: c.created_at };
  });
}

export async function setCaptureStatus(ctx: Ctx, id: string, status: "new" | "done") {
  await ctx.sb.from("captures").update({ status, done_at: status === "done" ? new Date().toISOString() : null }).eq("owner_id", ctx.ownerId).eq("id", id);
  await audit(ctx, `capture.${status === "done" ? "done" : "reopen"}`, id);
}

export async function deleteCapture(ctx: Ctx, id: string) {
  await ctx.sb.from("captures").delete().eq("owner_id", ctx.ownerId).eq("id", id);
  await audit(ctx, "capture.delete", id);
}

export async function inboxCount(ctx: Ctx) {
  const { count } = await ctx.sb.from("captures").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId).eq("status", "new");
  return count ?? 0;
}

// ─── Daily check-in ───────────────────────────────────────────────────────
const score = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

export async function saveCheckin(ctx: Ctx, input: { day?: string; mood?: unknown; energy?: unknown; sleep?: unknown; stress?: unknown; note?: string | null }) {
  const row = { owner_id: ctx.ownerId, day: input.day ?? todayUk(), mood: score(input.mood), energy: score(input.energy), sleep: score(input.sleep), stress: score(input.stress), note: input.note?.trim().slice(0, 2000) || null, updated_at: new Date().toISOString() };
  if (!row.mood && !row.energy && !row.sleep && !row.stress && !row.note) throw new UserError("Pick at least one score.");
  const { error } = await ctx.sb.from("checkins").upsert(row, { onConflict: "owner_id,day" });
  if (error) throw new Error(error.message);
  await audit(ctx, "checkin.save", row.day);
  return row;
}

export async function checkinData(ctx: Ctx, days = 30) {
  const today = todayUk();
  const [{ data: cs }, { data: ws }] = await Promise.all([
    ctx.sb.from("checkins").select("day, mood, energy, sleep, stress, note").eq("owner_id", ctx.ownerId).gte("day", addDays(today, -days)).order("day"),
    ctx.sb.from("workouts").select("started_at").eq("owner_id", ctx.ownerId).gte("started_at", `${addDays(today, -days)}T00:00:00Z`),
  ]);
  const list = (cs ?? []) as (Checkin & { note: string | null })[];
  const training = new Set((ws ?? []).map((w) => String(w.started_at).slice(0, 10)));
  return { today: list.find((c) => c.day === today) ?? null, recent: list, averages: checkinAverages(list.filter((c) => c.day >= addDays(today, -6))), insights: checkinInsights(list, training) };
}

// ─── Weekly review ────────────────────────────────────────────────────────
export async function gatherWeeklyReview(ctx: Ctx) {
  const today = todayUk();
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = addDays(today, -dow);
  const weekEnd = addDays(weekStart, 6);
  const lastStart = addDays(weekStart, -7);
  const safe = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  const [inv, props, deadlines, health, checks, journal, msgs] = await Promise.all([
    safe(async () => (await ctx.sb.from("xero_invoices").select("type, status, date, sub_total, fully_paid_on, amount_due, due_date, currency_rate").eq("owner_id", ctx.ownerId).eq("type", "ACCREC").gte("date", addDays(lastStart, -120))).data ?? []),
    safe(async () => (await ctx.sb.from("proposals").select("status, sent_at, decided_at").eq("owner_id", ctx.ownerId)).data ?? []),
    safe(() => upcomingDeadlines(ctx, { days: 14 })),
    safe(() => loadHealth(ctx, 30)),
    safe(() => checkinData(ctx, 14)),
    safe(async () => (await ctx.sb.from("journal_entries").select("themes").eq("owner_id", ctx.ownerId).gte("entry_date", weekStart)).data ?? []),
    safe(() => messageCounts(ctx)),
  ]);

  const posted = (i: { status: string }) => i.status === "AUTHORISED" || i.status === "PAID";
  const inRange = (d: string | null, a: string, b: string) => Boolean(d && d >= a && d <= b);
  const sumNet = (rows: typeof inv, a: string, b: string) => Math.round((rows ?? []).filter((i) => posted(i) && inRange(i.date, a, b)).reduce((s, i) => s + Number(i.sub_total) / (Number(i.currency_rate) || 1), 0) * 100) / 100;

  const input: WeeklyInput = { weekStart, weekEnd };
  if (inv && inv.length) {
    input.revenue = {
      thisWeek: sumNet(inv, weekStart, weekEnd),
      lastWeek: sumNet(inv, lastStart, addDays(weekStart, -1)),
      invoicesRaised: inv.filter((i) => posted(i) && inRange(i.date, weekStart, weekEnd)).length,
      invoicesPaid: inv.filter((i) => inRange(i.fully_paid_on, weekStart, weekEnd)).length,
      overdue: Math.round(inv.filter((i) => i.status === "AUTHORISED" && Number(i.amount_due) > 0 && i.due_date && i.due_date < today).reduce((s, i) => s + Number(i.amount_due), 0) * 100) / 100,
    };
  }
  if (props) {
    const sentThisWeek = props.filter((p) => inRange(p.sent_at?.slice(0, 10) ?? null, weekStart, weekEnd)).length;
    const decided = props.filter((p) => inRange(p.decided_at?.slice(0, 10) ?? null, weekStart, weekEnd));
    input.proposals = { sent: sentThisWeek, won: decided.filter((p) => p.status === "accepted").length, lost: decided.filter((p) => p.status === "declined").length };
  }
  if (deadlines) input.deadlines = deadlines.map((d) => ({ title: d.title, due: d.due, daysAway: d.daysAway }));
  if (health && (health.rows.length || health.workouts.length)) {
    const ws = health.workouts.filter((w) => inRange(w.started_at.slice(0, 10), weekStart, weekEnd));
    const lw = health.workouts.filter((w) => inRange(w.started_at.slice(0, 10), lastStart, addDays(weekStart, -1)));
    input.training = {
      sessions: ws.length,
      lastWeekSessions: lw.length,
      volumeKg: ws.reduce((a, w) => a + (Number(w.volume_kg) || 0), 0),
      lastWeekVolumeKg: lw.reduce((a, w) => a + (Number(w.volume_kg) || 0), 0),
      prs: liftRecords(health.workouts, today, dow + 1).recentPRs.map((p) => `${p.exercise} ${p.weightKg} kg × ${p.reps}`),
    };
    const n = nutritionSummary(health.rows, today, 7, { kcal: health.prefs.calorieTarget || undefined, protein: health.prefs.proteinTarget || undefined });
    input.nutrition = { avgKcal: n.avgKcal, avgProtein: n.avgProtein, daysLogged: n.daysLogged, kcalTarget: n.kcalTarget, proteinTarget: n.proteinTarget };
    const wc = weightChange(health.rows, today, 7);
    input.weight = wc ? { changeKg: wc.changeKg, avgKg: wc.latestAvg } : null;
  }
  if (checks) {
    input.checkins = checks.averages;
    input.insights = checks.insights;
  }
  if (journal) {
    const counts = new Map<string, number>();
    for (const j of journal) for (const t of j.themes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    input.journal = { entries: journal.length, themes: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t) };
  }
  if (msgs) input.messages = { unseen: msgs.unseen };
  return { ...composeWeeklyReview(input), input };
}

// ─── Search (command palette) ─────────────────────────────────────────────
export type SearchHit = { group: string; title: string; sub?: string; href: string };

export async function searchEverything(ctx: Ctx, q: string): Promise<SearchHit[]> {
  const term = q.trim();
  const like = `%${term.replace(/[%_]/g, "")}%`;
  const pages = NAV.filter((n) => n.label.toLowerCase().includes(term.toLowerCase())).map((n) => ({ group: "Go to", title: n.label, href: n.href }));
  if (term.length < 2) return pages;
  const [clients, proposals, invoices, journal, memories, captures] = await Promise.all([
    ctx.sb.from("clients").select("id, name, status").eq("owner_id", ctx.ownerId).ilike("name", like).limit(5),
    ctx.sb.from("proposals").select("id, number, title, client_name, status").eq("owner_id", ctx.ownerId).or(`title.ilike.${like},client_name.ilike.${like},number.ilike.${like}`).limit(5),
    ctx.sb.from("xero_invoices").select("invoice_id, number, contact_name, total, type").eq("owner_id", ctx.ownerId).or(`number.ilike.${like},contact_name.ilike.${like}`).order("date", { ascending: false }).limit(5),
    ctx.sb.from("journal_entries").select("id, title, entry_date").eq("owner_id", ctx.ownerId).textSearch("search", term, { type: "websearch", config: "english" }).limit(5),
    ctx.sb.from("knowledge_items").select("id, title, kind").eq("owner_id", ctx.ownerId).textSearch("search", term, { type: "websearch", config: "english" }).limit(5),
    ctx.sb.from("captures").select("id, title, kind").eq("owner_id", ctx.ownerId).ilike("title", like).limit(5),
  ]);
  return [
    ...pages,
    ...(clients.data ?? []).map((c) => ({ group: "Clients", title: c.name, sub: c.status, href: "/clients" })),
    ...(proposals.data ?? []).map((p) => ({ group: "Proposals", title: p.title, sub: `${p.number} · ${p.client_name} · ${p.status}`, href: `/proposals/${p.id}` })),
    ...(invoices.data ?? []).map((i) => ({ group: i.type === "ACCPAY" ? "Bills" : "Invoices", title: `${i.number ?? "Draft"} · ${i.contact_name ?? ""}`, sub: `£${Number(i.total).toFixed(2)}`, href: `/invoices?tab=${i.type === "ACCPAY" ? "bills" : "sales"}` })),
    ...(journal.data ?? []).map((j) => ({ group: "Journal", title: j.title, sub: j.entry_date.split("-").reverse().join("/"), href: `/journal/${j.id}` })),
    ...(memories.data ?? []).map((m) => ({ group: "Memory", title: m.title, sub: m.kind, href: `/memory?q=${encodeURIComponent(m.title)}` })),
    ...(captures.data ?? []).map((c) => ({ group: "Inbox", title: c.title ?? "Capture", sub: c.kind, href: "/inbox" })),
  ];
}

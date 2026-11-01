import { audit, getPrefs, UserError, vaultValues, type Ctx } from "@/lib/ctx";
import { daysBetween, todayUk } from "@/lib/dates";
import { addDays, addMonths, addMonthsEom } from "@/lib/periods";
import { round2 } from "@/lib/revenue/analytics";
import type { BankTransactionRow, InvoiceRow, LineRow } from "@/lib/revenue/types";
import { estimateCorporationTax, projectProfit, TAX_DISCLAIMER } from "@/lib/tax/ct";
import { ctAccountingPeriods, generateDeadlines, parseQuarterMonths, RULES, vatPeriodContaining, vatPeriods, type RuleId, type TaxConfig } from "@/lib/tax/rules";
import { vatIssues, vatPosition } from "@/lib/tax/vat";
import { reportValue } from "@/lib/xero/map";
import { cachedReport } from "@/lib/xero/sync";

/** Compliance tracker service: deadlines (with verification + done state), VAT and CT estimates. */

export async function taxConfig(ctx: Ctx): Promise<TaxConfig> {
  const v = await vaultValues(ctx);
  const { data: items } = await ctx.sb.from("vault_items").select("id, name, kind, renewal_date").eq("owner_id", ctx.ownerId).not("renewal_date", "is", null);
  return {
    incorporationDate: v.incorporation_date ?? "2026-10-03",
    yearEnd: v.accounting_year_end ?? "31/10",
    vatRegistrationDate: v.vat_registration_date ?? null,
    vatQuarterEndMonths: parseQuarterMonths(v.vat_quarter_ends),
    vatFirstPeriodEnd: v.vat_first_period_end ?? null,
    ctStartDate: v.ct_start_date ?? null,
    payrollEnabled: v.payroll_enabled === "Yes",
    includeSelfAssessment: true,
    renewals: (items ?? []).map((i) => ({ id: i.id, name: i.name, kind: i.kind, renewalDate: i.renewal_date })),
  };
}

export async function verifications(ctx: Ctx) {
  const { data } = await ctx.sb.from("tax_rule_verifications").select("rule_id, verified_at, verified_by, note").eq("owner_id", ctx.ownerId);
  return new Map((data ?? []).map((r) => [r.rule_id as string, r]));
}

export async function upcomingDeadlines(ctx: Ctx, opts: { days?: number; includeDone?: boolean; fromDaysAgo?: number } = {}) {
  const today = todayUk();
  const cfg = await taxConfig(ctx);
  const [ver, doneRows] = await Promise.all([verifications(ctx), ctx.sb.from("deadline_status").select("deadline_key, done_at, note").eq("owner_id", ctx.ownerId)]);
  const done = new Map((doneRows.data ?? []).map((d) => [d.deadline_key as string, d]));
  const list = generateDeadlines(cfg, addDays(today, -(opts.fromDaysAgo ?? 60)), addDays(today, opts.days ?? 400));
  return list
    .map((d) => ({
      ...d,
      daysAway: daysBetween(today, d.due),
      verified: d.ruleId === "renewal" || ver.has(d.ruleId),
      done: done.has(d.key),
      doneAt: (done.get(d.key)?.done_at as string) ?? null,
      overdue: !done.has(d.key) && d.due < today,
    }))
    .filter((d) => opts.includeDone || !d.done)
    .filter((d) => d.due >= today || d.overdue || opts.includeDone);
}

export async function markDeadlineDone(ctx: Ctx, key: string, note?: string | null, undo = false) {
  if (!/^[a-z_]+:[\w:-]+$/.test(key)) throw new UserError("Unknown deadline key.");
  if (undo) await ctx.sb.from("deadline_status").delete().eq("owner_id", ctx.ownerId).eq("deadline_key", key);
  else await ctx.sb.from("deadline_status").upsert({ owner_id: ctx.ownerId, deadline_key: key, note: note ?? null, done_at: new Date().toISOString() }, { onConflict: "owner_id,deadline_key" });
  await audit(ctx, undo ? "tax.deadline_reopened" : "tax.deadline_done", key, note ? { note } : {});
  return { key, done: !undo };
}

export async function verifyRule(ctx: Ctx, ruleId: RuleId, verifiedBy: string, note?: string | null, revoke = false) {
  if (!RULES[ruleId]) throw new UserError("Unknown rule.");
  if (revoke) await ctx.sb.from("tax_rule_verifications").delete().eq("owner_id", ctx.ownerId).eq("rule_id", ruleId);
  else await ctx.sb.from("tax_rule_verifications").upsert({ owner_id: ctx.ownerId, rule_id: ruleId, verified_by: verifiedBy, note: note ?? null, verified_at: new Date().toISOString() }, { onConflict: "owner_id,rule_id" });
  await audit(ctx, revoke ? "tax.rule_unverified" : "tax.rule_verified", ruleId, { by: verifiedBy });
}

async function mirror(ctx: Ctx, start: string, end: string) {
  const [inv, bank] = await Promise.all([
    ctx.sb.from("xero_invoices").select("*").eq("owner_id", ctx.ownerId).gte("date", start).lte("date", end),
    ctx.sb.from("xero_bank_transactions").select("*").eq("owner_id", ctx.ownerId).gte("date", start).lte("date", end),
  ]);
  const invoices = (inv.data ?? []) as InvoiceRow[];
  const ids = invoices.map((i) => i.invoice_id);
  const lines: LineRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await ctx.sb.from("xero_invoice_lines").select("*").eq("owner_id", ctx.ownerId).in("invoice_id", ids.slice(i, i + 200));
    lines.push(...((data ?? []) as LineRow[]));
  }
  return { invoices, lines, bank: (bank.data ?? []) as BankTransactionRow[] };
}

/** VAT period selector: "current", "previous", or a period end date (YYYY-MM-DD). */
export async function resolveVatPeriod(ctx: Ctx, which: string = "current") {
  const cfg = await taxConfig(ctx);
  if (!cfg.vatRegistrationDate || !cfg.vatQuarterEndMonths.length) throw new UserError("Add the VAT registration date and quarter end months in the Company Vault first.");
  const today = todayUk();
  const periods = vatPeriods(cfg, addMonths(today, 3));
  if (which === "current") return vatPeriodContaining(cfg, today) ?? periods[periods.length - 1];
  if (which === "previous") {
    const cur = vatPeriodContaining(cfg, today);
    const idx = periods.findIndex((p) => p.end === cur?.end);
    if (idx <= 0) throw new UserError("There's no earlier VAT period yet.");
    return periods[idx - 1];
  }
  const hit = periods.find((p) => p.end === which || (p.start <= which && which <= p.end));
  if (!hit) throw new UserError(`No VAT period matches ${which}.`);
  return hit;
}

export async function vatReport(ctx: Ctx, which = "current") {
  const p = await resolveVatPeriod(ctx, which);
  const m = await mirror(ctx, p.start, p.end);
  const { data: accounts } = await ctx.sb.from("xero_accounts").select("code, tax_type").eq("owner_id", ctx.ownerId);
  const accountTaxTypes = Object.fromEntries((accounts ?? []).filter((a) => a.code && a.tax_type).map((a) => [a.code as string, a.tax_type as string]));
  const position = vatPosition(p.start, p.end, m.invoices, m.lines, m.bank);
  const issues = vatIssues(p.start, p.end, m.invoices, m.lines, m.bank, accountTaxTypes);
  return { period: p, position, issues, dueDate: addDays(addMonthsEom(p.end, 1), 7), note: "Estimate from Jarvis's copy of Xero. Xero's VAT return is authoritative; your accountant reviews before submission." };
}

/** Profit for a period: Xero P&L report when connected (cached), else from the mirror. */
export async function profitForPeriod(ctx: Ctx, start: string, end: string): Promise<{ profit: number; source: "xero_report" | "mirror" }> {
  try {
    const rep = await cachedReport(ctx, `pl:${start}:${end}`, 360, (x) => x.json("/Reports/ProfitAndLoss", { query: { fromDate: start, toDate: end } }));
    const v = reportValue(rep.data as Record<string, unknown>, /^net profit$/i);
    if (v !== null) return { profit: v, source: "xero_report" };
  } catch {
    // fall back to the mirror
  }
  const m = await mirror(ctx, start, end);
  const posted = new Set(["AUTHORISED", "PAID"]);
  const byId = new Map(m.invoices.map((i) => [i.invoice_id, i]));
  let profit = 0;
  for (const l of m.lines) {
    const i = byId.get(l.invoice_id);
    if (!i || !posted.has(i.status)) continue;
    const rate = Number(i.currency_rate) || 1;
    const sign = { ACCREC: 1, ACCRECCREDIT: -1, ACCPAY: -1, ACCPAYCREDIT: 1 }[i.type];
    profit += (sign * Number(l.net_amount)) / rate;
  }
  for (const t of m.bank) {
    const net = Number(t.sub_total);
    if (t.type.startsWith("RECEIVE")) profit += net;
    if (t.type.startsWith("SPEND")) profit -= net;
  }
  return { profit: round2(profit), source: "mirror" };
}

export async function corporationTaxEstimate(ctx: Ctx) {
  const today = todayUk();
  const cfg = await taxConfig(ctx);
  const prefs = await getPrefs(ctx);
  const aps = ctAccountingPeriods(cfg, addMonths(today, 12));
  const ap = aps.find((a) => a.start <= today && today <= a.end) ?? aps[0];
  const { profit, source } = await profitForPeriod(ctx, ap.start, today < ap.end ? today : ap.end);
  const projected = projectProfit(profit, ap.start, ap.end, today);
  return {
    accountingPeriod: { start: ap.start, end: ap.end },
    profitToDate: profit,
    profitSource: source,
    toDate: estimateCorporationTax(profit, ap.start, ap.end, prefs.associatedCompanies),
    projectedFullPeriod: estimateCorporationTax(projected, ap.start, ap.end, prefs.associatedCompanies),
    disclaimer: TAX_DISCLAIMER,
  };
}

/** "Money to set aside": VAT owed for the current (and any unpaid previous) quarter plus CT accrued to date. */
export async function taxSetAside(ctx: Ctx) {
  const today = todayUk();
  const current = await vatReport(ctx, "current").catch(() => null);
  let previous: Awaited<ReturnType<typeof vatReport>> | null = null;
  const prevPeriod = await resolveVatPeriod(ctx, "previous").catch(() => null);
  if (prevPeriod) {
    const { data: done } = await ctx.sb.from("deadline_status").select("deadline_key").eq("owner_id", ctx.ownerId).eq("deadline_key", `vat_return:${prevPeriod.end}`).maybeSingle();
    if (!done && addDays(addMonthsEom(prevPeriod.end, 1), 7) >= addDays(today, -30)) previous = await vatReport(ctx, prevPeriod.end).catch(() => null);
  }
  const ct = await corporationTaxEstimate(ctx).catch(() => null);
  const vatCurrent = Math.max(0, current?.position.box5NetVat ?? 0);
  const vatPrevious = Math.max(0, previous?.position.box5NetVat ?? 0);
  const ctToDate = ct?.toDate.tax ?? 0;
  return {
    vatCurrentQuarter: { amount: vatCurrent, period: current?.period ?? null, due: current?.dueDate ?? null },
    vatPreviousQuarter: previous ? { amount: vatPrevious, period: previous.period, due: previous.dueDate } : null,
    corporationTaxToDate: { amount: ctToDate, period: ct?.accountingPeriod ?? null, projectedFullPeriod: ct?.projectedFullPeriod.tax ?? null },
    total: round2(vatCurrent + vatPrevious + ctToDate),
    disclaimer: TAX_DISCLAIMER,
  };
}

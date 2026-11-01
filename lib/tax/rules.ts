import { formatUkDate } from "@/lib/dates";
import { addDays, addMonths, addMonthsEom, iso, monthEnd, parts } from "@/lib/periods";

/**
 * UK compliance deadline rules for a small limited company. These rules are
 * configuration, NOT advice: each carries an "unverified" badge until the
 * accountant confirms it (tax_rule_verifications). Jarvis never files anything.
 */

export type RuleId = "vat_return" | "ct_payment" | "ct600" | "accounts" | "confirmation_statement" | "paye" | "self_assessment" | "renewal";

export const RULES: Record<RuleId, { label: string; summary: string; authority: "HMRC" | "Companies House" | "Internal" }> = {
  vat_return: { label: "VAT return and payment", summary: "Return and payment due 1 calendar month and 7 days after the end of each VAT quarter (submitted via Xero, MTD).", authority: "HMRC" },
  ct_payment: { label: "Corporation tax payment", summary: "Due 9 months and 1 day after the end of each corporation tax accounting period (not a large company).", authority: "HMRC" },
  ct600: { label: "Corporation tax return (CT600)", summary: "Due 12 months after the end of the accounting period, or 12 months after the end of a longer period of account (up to 18 months) if later.", authority: "HMRC" },
  accounts: { label: "Annual accounts to Companies House", summary: "First accounts due 21 months after incorporation; later accounts 9 months after the period end.", authority: "Companies House" },
  confirmation_statement: { label: "Confirmation statement", summary: "Due within 14 days after each anniversary of incorporation (the confirmation date).", authority: "Companies House" },
  paye: { label: "PAYE payment (RTI)", summary: "FPS on or before each payday; PAYE/NIC paid electronically by the 22nd after each tax month ends (5th).", authority: "HMRC" },
  self_assessment: { label: "Director's Self Assessment", summary: "Personal tax return and balancing payment due 31 January after the tax year (5 April). Personal, not the company's.", authority: "HMRC" },
  renewal: { label: "Renewals", summary: "Insurance policies, subscriptions and supplier contracts from the Company Vault.", authority: "Internal" },
};

export type TaxConfig = {
  incorporationDate: string;
  /** Accounting reference day/month, "31/10". */
  yearEnd: string;
  vatRegistrationDate: string | null;
  /** Months (1-12) in which VAT quarters end, e.g. [3, 6, 9, 12]. */
  vatQuarterEndMonths: number[];
  /** Override for an unusual first VAT period (from the VAT certificate). */
  vatFirstPeriodEnd?: string | null;
  /** When the company came within the charge to CT (started trading). Defaults to incorporation. */
  ctStartDate?: string | null;
  payrollEnabled?: boolean;
  includeSelfAssessment?: boolean;
  renewals?: { id: string; name: string; kind: string; renewalDate: string }[];
};

export type Deadline = {
  key: string;
  ruleId: RuleId;
  title: string;
  due: string;
  periodStart?: string;
  periodEnd?: string;
  authority: string;
  personal?: boolean;
  note?: string;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Mar, Jun, Sep, Dec" / "March June September December" / "3,6,9,12" → [3,6,9,12]. */
export function parseQuarterMonths(input: string | null | undefined): number[] {
  if (!input) return [];
  const out = new Set<number>();
  for (const tok of input.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const n = Number(tok);
    if (Number.isInteger(n) && n >= 1 && n <= 12) out.add(n);
    else if (MONTHS[tok.slice(0, 3)]) out.add(MONTHS[tok.slice(0, 3)]);
  }
  return [...out].sort((a, b) => a - b);
}

/** Accounting reference date for the period-of-account ending in `year`. */
function ardInYear(yearEnd: string, year: number): string {
  const [d, m] = yearEnd.split("/").map(Number);
  const end = monthEnd(iso(year, m, 1));
  return d >= Number(end.slice(8)) ? end : iso(year, m, d);
}

/**
 * Periods of account (Companies House). The first runs from incorporation to
 * the first ARD at least 6 months later and no more than 18 months (normally
 * the ARD in the month of the first anniversary); then yearly.
 */
export function periodsOfAccount(cfg: TaxConfig, until: string) {
  const periods: { start: string; end: string; first: boolean }[] = [];
  const [iy] = parts(cfg.incorporationDate);
  // First ARD: the last day of the month in which the anniversary falls, or the
  // configured year end if it falls between 6 and 18 months after incorporation.
  let firstEnd = ardInYear(cfg.yearEnd, iy);
  while (firstEnd <= addMonths(cfg.incorporationDate, 6)) firstEnd = ardInYear(cfg.yearEnd, Number(firstEnd.slice(0, 4)) + 1);
  if (firstEnd > addMonths(cfg.incorporationDate, 18)) firstEnd = ardInYear(cfg.yearEnd, Number(firstEnd.slice(0, 4)) - 1);
  periods.push({ start: cfg.incorporationDate, end: firstEnd, first: true });
  while (periods[periods.length - 1].end < until) {
    const prev = periods[periods.length - 1];
    const start = addDays(prev.end, 1);
    periods.push({ start, end: ardInYear(cfg.yearEnd, Number(prev.end.slice(0, 4)) + 1), first: false });
  }
  return periods;
}

/**
 * Corporation tax accounting periods: a period of account longer than 12
 * months splits into a first 12-month period and a short second period.
 */
export function ctAccountingPeriods(cfg: TaxConfig, until: string) {
  const out: { start: string; end: string; periodOfAccount: { start: string; end: string } }[] = [];
  const ctStart = cfg.ctStartDate && cfg.ctStartDate > cfg.incorporationDate ? cfg.ctStartDate : cfg.incorporationDate;
  for (const poa of periodsOfAccount(cfg, until)) {
    let start = poa.start < ctStart ? ctStart : poa.start;
    if (start > poa.end) continue;
    while (start <= poa.end) {
      const twelve = addDays(addMonths(start, 12), -1);
      const end = twelve < poa.end ? twelve : poa.end;
      out.push({ start, end, periodOfAccount: { start: poa.start, end: poa.end } });
      start = addDays(end, 1);
    }
  }
  return out;
}

/** VAT periods from registration, using the stagger months (or an explicit first period end). */
export function vatPeriods(cfg: TaxConfig, until: string) {
  if (!cfg.vatRegistrationDate || !cfg.vatQuarterEndMonths.length) return [];
  const periods: { start: string; end: string }[] = [];
  const nextQuarterEnd = (from: string) => {
    let d = monthEnd(from);
    while (!cfg.vatQuarterEndMonths.includes(Number(d.slice(5, 7)))) d = monthEnd(addMonths(iso(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1), 1));
    return d;
  };
  let start = cfg.vatRegistrationDate;
  let end = cfg.vatFirstPeriodEnd && cfg.vatFirstPeriodEnd > start ? cfg.vatFirstPeriodEnd : nextQuarterEnd(start);
  while (start <= until) {
    periods.push({ start, end });
    start = addDays(end, 1);
    end = nextQuarterEnd(addMonths(iso(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 1), 1));
  }
  return periods;
}

export function vatPeriodContaining(cfg: TaxConfig, date: string) {
  return vatPeriods(cfg, addMonths(date, 4)).find((p) => p.start <= date && date <= p.end) ?? null;
}

/** All deadlines from `from` to `to` (inclusive). */
export function generateDeadlines(cfg: TaxConfig, from: string, to: string): Deadline[] {
  const out: Deadline[] = [];
  const horizon = addMonths(to, 1);

  for (const p of vatPeriods(cfg, horizon)) {
    out.push({
      key: `vat_return:${p.end}`,
      ruleId: "vat_return",
      title: `VAT return and payment (${formatUkDate(p.start)} – ${formatUkDate(p.end)})`,
      due: addDays(addMonthsEom(p.end, 1), 7),
      periodStart: p.start,
      periodEnd: p.end,
      authority: "HMRC",
      note: "Direct debit is collected 3 working days after the due date. Submit through Xero after your accountant reviews it.",
    });
  }

  for (const ap of ctAccountingPeriods(cfg, horizon)) {
    out.push({
      key: `ct_payment:${ap.end}`,
      ruleId: "ct_payment",
      title: `Corporation tax payment (${formatUkDate(ap.start)} – ${formatUkDate(ap.end)})`,
      due: addDays(addMonthsEom(ap.end, 9), 1),
      periodStart: ap.start,
      periodEnd: ap.end,
      authority: "HMRC",
    });
    const poaMonths = (Date.parse(ap.periodOfAccount.end) - Date.parse(ap.periodOfAccount.start)) / (86_400_000 * 30.44);
    const byAp = addMonthsEom(ap.end, 12);
    const byPoa = poaMonths <= 18.1 ? addMonthsEom(ap.periodOfAccount.end, 12) : byAp;
    out.push({
      key: `ct600:${ap.end}`,
      ruleId: "ct600",
      title: `CT600 return (${formatUkDate(ap.start)} – ${formatUkDate(ap.end)})`,
      due: byAp > byPoa ? byAp : byPoa,
      periodStart: ap.start,
      periodEnd: ap.end,
      authority: "HMRC",
    });
  }

  for (const poa of periodsOfAccount(cfg, horizon)) {
    out.push({
      key: `accounts:${poa.end}`,
      ruleId: "accounts",
      title: `${poa.first ? "First annual accounts" : "Annual accounts"} (${formatUkDate(poa.start)} – ${formatUkDate(poa.end)})`,
      due: poa.first ? addMonths(cfg.incorporationDate, 21) : addMonthsEom(poa.end, 9),
      periodStart: poa.start,
      periodEnd: poa.end,
      authority: "Companies House",
      note: poa.first ? "First accounts: 21 months from incorporation." : undefined,
    });
  }

  for (let n = 1; ; n++) {
    const confirmationDate = addMonths(cfg.incorporationDate, 12 * n);
    if (confirmationDate > horizon) break;
    out.push({
      key: `confirmation_statement:${confirmationDate}`,
      ruleId: "confirmation_statement",
      title: `Confirmation statement (confirmation date ${formatUkDate(confirmationDate)})`,
      due: addDays(confirmationDate, 14),
      authority: "Companies House",
    });
  }

  if (cfg.payrollEnabled) {
    let m = iso(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 1);
    while (m <= horizon) {
      const taxMonthEnd = iso(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 5);
      out.push({
        key: `paye:${taxMonthEnd}`,
        ruleId: "paye",
        title: `PAYE/NIC payment (tax month to ${formatUkDate(taxMonthEnd)})`,
        due: iso(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 22),
        authority: "HMRC",
        note: "Send the FPS on or before each payday.",
      });
      m = addMonths(m, 1);
    }
  }

  if (cfg.includeSelfAssessment !== false) {
    for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++) {
      out.push({
        key: `self_assessment:${y}`,
        ruleId: "self_assessment",
        title: `Director's Self Assessment for ${y - 1}/${String(y).slice(2)} tax year`,
        due: iso(y, 1, 31),
        authority: "HMRC",
        personal: true,
        note: "Personal return and balancing payment (and first payment on account, if any).",
      });
    }
  }

  for (const r of cfg.renewals ?? []) {
    out.push({ key: `renewal:${r.id}:${r.renewalDate}`, ruleId: "renewal", title: `${r.name} renewal (${r.kind})`, due: r.renewalDate, authority: "Internal" });
  }

  return out.filter((d) => d.due >= from && d.due <= to).sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key));
}

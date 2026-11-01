import { formatUkDate } from "@/lib/dates";

/** Date-period helpers. All dates are ISO (YYYY-MM-DD) calendar dates in UK time. */

export function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add calendar months, clamping to the month end (31/01 + 1 month = 28/02 or 29/02). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/**
 * Add months the way HMRC and Companies House count from a month end:
 * 30/06 + 1 month = 31/07 (month end to month end). Other dates as addMonths.
 */
export function addMonthsEom(date: string, n: number): string {
  return date === monthEnd(date) ? monthEnd(addMonths(date, n)) : addMonths(date, n);
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function monthEnd(date: string): string {
  const [y, m] = parts(date);
  return iso(y, m, daysInMonth(y, m));
}

export function monthStart(date: string): string {
  const [y, m] = parts(date);
  return iso(y, m, 1);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Inclusive list of YYYY-MM keys from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = monthStart(from);
  const last = monthStart(to);
  while (cur <= last) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

/** Last `n` month keys ending with the month containing `today`. */
export function lastMonths(today: string, n: number): string[] {
  return monthRange(addMonths(monthStart(today), -(n - 1)), today);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export type PeriodKey = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "ytd" | "last_year" | "last_12_months" | "all";

export const PERIOD_KEYS: readonly PeriodKey[] = ["this_month", "last_month", "this_quarter", "last_quarter", "ytd", "last_year", "last_12_months", "all"];

export type Period = { key: PeriodKey; start: string; end: string; label: string };

/** Financial year containing `date`, given the first month of the year (Qevero: November). */
export function financialYear(date: string, fyStartMonth: number): { start: string; end: string } {
  const [y, m] = parts(date);
  const startYear = m >= fyStartMonth ? y : y - 1;
  const start = iso(startYear, fyStartMonth, 1);
  return { start, end: addDays(addMonths(start, 12), -1) };
}

/** Calendar quarter (which matches Qevero's VAT quarters: Mar, Jun, Sep, Dec). */
export function quarterOf(date: string): { start: string; end: string } {
  const [y, m] = parts(date);
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const start = iso(y, qStartMonth, 1);
  return { start, end: monthEnd(addMonths(start, 2)) };
}

export function resolvePeriod(key: PeriodKey, today: string, fyStartMonth = 11): Period {
  const label = (start: string, end: string, name: string) => `${name} (${formatUkDate(start)} – ${formatUkDate(end)})`;
  switch (key) {
    case "this_month": {
      const start = monthStart(today);
      return { key, start, end: monthEnd(today), label: label(start, monthEnd(today), "This month") };
    }
    case "last_month": {
      const start = addMonths(monthStart(today), -1);
      return { key, start, end: monthEnd(start), label: label(start, monthEnd(start), "Last month") };
    }
    case "this_quarter": {
      const q = quarterOf(today);
      return { key, ...q, label: label(q.start, q.end, "This quarter") };
    }
    case "last_quarter": {
      const q = quarterOf(addMonths(quarterOf(today).start, -3));
      return { key, ...q, label: label(q.start, q.end, "Last quarter") };
    }
    case "ytd": {
      const fy = financialYear(today, fyStartMonth);
      return { key, start: fy.start, end: today, label: label(fy.start, today, "Financial year to date") };
    }
    case "last_year": {
      const fy = financialYear(addMonths(financialYear(today, fyStartMonth).start, -12), fyStartMonth);
      return { key, ...fy, label: label(fy.start, fy.end, "Last financial year") };
    }
    case "last_12_months": {
      const start = addMonths(monthStart(today), -11);
      return { key, start, end: today, label: label(start, today, "Last 12 months") };
    }
    case "all":
      return { key, start: "2000-01-01", end: today, label: "All time" };
  }
}

export function inRange(date: string | null | undefined, start: string, end: string): boolean {
  return Boolean(date && date >= start && date <= end);
}

/** First month of the financial year, from a DD/MM year end (31/10 → 11). */
export function fyStartMonthFromYearEnd(yearEnd: string | null | undefined): number {
  const m = /^(\d{2})\/(\d{2})$/.exec(yearEnd ?? "");
  if (!m) return 11;
  return (Number(m[2]) % 12) + 1;
}

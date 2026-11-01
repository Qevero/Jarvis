/** UK date helpers. Storage is ISO (YYYY-MM-DD); display is DD/MM/YYYY. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UK_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isValidYmd(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Accepts DD/MM/YYYY or YYYY-MM-DD and returns ISO, or null if invalid. */
export function parseDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  const iso = ISO_RE.exec(s);
  const uk = UK_RE.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (uk) {
    [d, m, y] = [Number(uk[1]), Number(uk[2]), Number(uk[3])];
  } else {
    return null;
  }
  if (!isValidYmd(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO date (or full timestamp) → DD/MM/YYYY. Timestamps are shown in UK time. */
export function formatUkDate(value: string | null | undefined): string {
  if (!value) return "";
  const iso = ISO_RE.exec(value);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric" }).format(dt);
}

export function formatUkDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

/** Accepts "31/10" or "31-10" style day/month (e.g. accounting year end) → "31/10". */
export function parseDayMonth(input: string): string | null {
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(input.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  // 2028 is a leap year, so 29/02 is allowed.
  if (!isValidYmd(2028, mo, d)) return null;
  return `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}`;
}

/** Today's date in the UK as ISO. */
export function todayUk(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole days from `fromIso` to `toIso` (positive if `toIso` is later). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function formatGbpFromPence(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return "";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

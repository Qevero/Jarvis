import { daysBetween } from "@/lib/dates";
import type { ProfileField } from "./service";
import type { VaultItem } from "./store";

/** Fields Jarvis needs before it is useful; shown as "missing" on Home. */
export const KEY_FIELDS = [
  "legal_name",
  "company_number",
  "incorporation_date",
  "registered_office",
  "vat_number",
  "vat_registration_date",
  "vat_scheme",
  "vat_quarter_ends",
  "corporation_tax_utr",
  "accounting_year_end",
] as const;

export function vaultCompleteness(profile: Pick<ProfileField, "key" | "label" | "display">[]) {
  const key = profile.filter((f) => (KEY_FIELDS as readonly string[]).includes(f.key));
  const missing = key.filter((f) => f.display === null).map((f) => f.label);
  return { total: key.length, filled: key.length - missing.length, missing };
}

/** Items with a renewal date within `days` from today (overdue included). */
export function upcomingRenewals(items: VaultItem[], todayIso: string, days = 90) {
  return items
    .filter((i) => i.renewal_date)
    .map((i) => ({ item: i, daysAway: daysBetween(todayIso, i.renewal_date!) }))
    .filter((r) => r.daysAway <= days)
    .sort((a, b) => a.daysAway - b.daysAway);
}

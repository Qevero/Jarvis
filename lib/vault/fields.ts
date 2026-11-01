import { parseDate, parseDayMonth } from "@/lib/dates";

/**
 * The Company Vault field registry. Adding a field here makes it editable in
 * the dashboard and available to Claude through the MCP tools.
 */

export type FieldType = "text" | "longtext" | "date" | "daymonth" | "enum" | "email";

export type VaultField = {
  key: string;
  label: string;
  section: FieldSection;
  type: FieldType;
  sensitive?: boolean;
  options?: readonly string[];
  hint?: string;
  /** Default applied when the vault is first initialised. */
  seed?: string;
};

export const SECTIONS = ["Company", "VAT", "Corporation tax", "Banking", "Advisers"] as const;
export type FieldSection = (typeof SECTIONS)[number];

export const VAT_SCHEMES = ["Standard", "Flat Rate", "Cash Accounting", "Annual Accounting"] as const;

export const FIELDS: readonly VaultField[] = [
  { key: "legal_name", label: "Legal name", section: "Company", type: "text", seed: "Qevero Ltd" },
  { key: "trading_name", label: "Trading name", section: "Company", type: "text", seed: "Qevero" },
  { key: "company_number", label: "Company number", section: "Company", type: "text", hint: "8 characters, e.g. 12345678" },
  { key: "incorporation_date", label: "Incorporation date", section: "Company", type: "date", seed: "2026-10-03" },
  { key: "registered_office", label: "Registered office", section: "Company", type: "longtext" },
  { key: "sic_codes", label: "SIC codes", section: "Company", type: "text" },
  { key: "website", label: "Website", section: "Company", type: "text", seed: "https://qevero.com" },
  { key: "accounting_year_end", label: "Accounting year end", section: "Company", type: "daymonth", seed: "31/10", hint: "DD/MM" },

  { key: "vat_number", label: "VAT number", section: "VAT", type: "text", hint: "e.g. GB123456789" },
  { key: "vat_registration_date", label: "VAT registration date", section: "VAT", type: "date", seed: "2026-10-03" },
  { key: "vat_return_frequency", label: "VAT return frequency", section: "VAT", type: "enum", options: ["Quarterly", "Monthly", "Annual"], seed: "Quarterly" },
  { key: "vat_scheme", label: "VAT scheme", section: "VAT", type: "enum", options: VAT_SCHEMES },
  { key: "vat_quarter_ends", label: "VAT quarter end months", section: "VAT", type: "text", hint: "As on your VAT certificate, e.g. Jan, Apr, Jul, Oct" },
  { key: "vat_first_period_end", label: "First VAT period end", section: "VAT", type: "date" },

  { key: "corporation_tax_utr", label: "Corporation tax UTR", section: "Corporation tax", type: "text", sensitive: true, hint: "10 digits" },

  { key: "bank_name", label: "Bank", section: "Banking", type: "text" },
  { key: "bank_sort_code", label: "Sort code", section: "Banking", type: "text", sensitive: true },
  { key: "bank_account_number", label: "Account number", section: "Banking", type: "text", sensitive: true },

  { key: "accountant_name", label: "Accountant", section: "Advisers", type: "text" },
  { key: "accountant_email", label: "Accountant email", section: "Advisers", type: "email" },
] as const;

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function getField(key: string): VaultField | undefined {
  return BY_KEY.get(key);
}

export type ValidationResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Normalise and validate a value for a field. Empty input clears the field. */
export function validateFieldValue(field: VaultField, raw: string): ValidationResult {
  const input = raw.trim();
  if (input === "") return { ok: true, value: null };
  if (input.length > 2000) return { ok: false, error: "Value is too long." };

  switch (field.type) {
    case "date": {
      const iso = parseDate(input);
      return iso ? { ok: true, value: iso } : { ok: false, error: "Use DD/MM/YYYY." };
    }
    case "daymonth": {
      const dm = parseDayMonth(input);
      return dm ? { ok: true, value: dm } : { ok: false, error: "Use DD/MM, e.g. 31/10." };
    }
    case "enum": {
      const match = field.options?.find((o) => o.toLowerCase() === input.toLowerCase());
      return match ? { ok: true, value: match } : { ok: false, error: `Choose one of: ${field.options?.join(", ")}.` };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? { ok: true, value: input.toLowerCase() } : { ok: false, error: "Not a valid email address." };
    default:
      break;
  }

  switch (field.key) {
    case "company_number": {
      const v = input.toUpperCase().replace(/\s+/g, "");
      return /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(v) ? { ok: true, value: v } : { ok: false, error: "Company numbers are 8 characters, e.g. 12345678 or SC123456." };
    }
    case "vat_number": {
      const v = input.toUpperCase().replace(/\s+/g, "");
      const withPrefix = v.startsWith("GB") ? v : `GB${v}`;
      return /^GB([0-9]{9}|[0-9]{12})$/.test(withPrefix) ? { ok: true, value: withPrefix } : { ok: false, error: "UK VAT numbers are GB followed by 9 digits." };
    }
    case "corporation_tax_utr": {
      const v = input.replace(/\s+/g, "");
      return /^[0-9]{10}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "A UTR is 10 digits." };
    }
    case "bank_sort_code": {
      const digits = input.replace(/[\s-]/g, "");
      return /^[0-9]{6}$/.test(digits) ? { ok: true, value: `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}` } : { ok: false, error: "A sort code is 6 digits." };
    }
    case "bank_account_number": {
      const v = input.replace(/\s+/g, "");
      return /^[0-9]{8}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "A UK account number is 8 digits." };
    }
    default:
      return { ok: true, value: input };
  }
}

export const ITEM_KINDS = ["director", "insurance", "supplier", "subscription"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  director: "Directors",
  insurance: "Insurance policies",
  supplier: "Key suppliers",
  subscription: "Subscriptions",
};

export const BILLING_PERIODS = ["monthly", "quarterly", "annual", "one-off"] as const;

export const DOCUMENT_CATEGORIES = ["incorporation", "vat", "insurance", "tax", "banking", "contract", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

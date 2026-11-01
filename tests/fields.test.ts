import { describe, expect, it } from "vitest";
import { FIELDS, getField, validateFieldValue } from "@/lib/vault/fields";

const v = (key: string, value: string) => validateFieldValue(getField(key)!, value);

describe("field registry", () => {
  it("has unique keys matching the database constraint", () => {
    const keys = FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]{1,62}$/);
  });
  it("marks UTR and bank details as sensitive", () => {
    expect(FIELDS.filter((f) => f.sensitive).map((f) => f.key).sort()).toEqual(["bank_account_number", "bank_sort_code", "corporation_tax_utr"]);
  });
  it("seeds what we already know", () => {
    expect(getField("incorporation_date")!.seed).toBe("2026-10-03");
    expect(getField("vat_registration_date")!.seed).toBe("2026-10-03");
    expect(getField("accounting_year_end")!.seed).toBe("31/10");
    expect(getField("vat_return_frequency")!.seed).toBe("Quarterly");
  });
});

describe("validateFieldValue", () => {
  it("normalises VAT numbers", () => {
    expect(v("vat_number", "123 4567 89")).toEqual({ ok: true, value: "GB123456789" });
    expect(v("vat_number", "gb123456789")).toEqual({ ok: true, value: "GB123456789" });
    expect(v("vat_number", "12345").ok).toBe(false);
  });
  it("validates company numbers", () => {
    expect(v("company_number", "12345678")).toEqual({ ok: true, value: "12345678" });
    expect(v("company_number", "sc123456")).toEqual({ ok: true, value: "SC123456" });
    expect(v("company_number", "1234").ok).toBe(false);
  });
  it("validates UTR, sort code and account number", () => {
    expect(v("corporation_tax_utr", "12345 67890")).toEqual({ ok: true, value: "1234567890" });
    expect(v("corporation_tax_utr", "123").ok).toBe(false);
    expect(v("bank_sort_code", "123456")).toEqual({ ok: true, value: "12-34-56" });
    expect(v("bank_account_number", "1234567").ok).toBe(false);
  });
  it("stores dates as ISO and year end as DD/MM", () => {
    expect(v("incorporation_date", "03/10/2026")).toEqual({ ok: true, value: "2026-10-03" });
    expect(v("incorporation_date", "2026/10/03").ok).toBe(false);
    expect(v("accounting_year_end", "31-10")).toEqual({ ok: true, value: "31/10" });
  });
  it("matches enum options case-insensitively", () => {
    expect(v("vat_scheme", "flat rate")).toEqual({ ok: true, value: "Flat Rate" });
    expect(v("vat_scheme", "made up").ok).toBe(false);
  });
  it("treats blank as clear", () => {
    expect(v("vat_number", "  ")).toEqual({ ok: true, value: null });
  });
});

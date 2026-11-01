import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createVaultService, SEED_MARKER, VaultError } from "@/lib/vault/service";
import { upcomingRenewals, vaultCompleteness } from "@/lib/vault/summary";
import { memoryStore } from "./memory-store";

const key = randomBytes(32).toString("base64");

describe("vault service", () => {
  let mem: ReturnType<typeof memoryStore>;
  let vault: ReturnType<typeof createVaultService>;

  beforeEach(() => {
    mem = memoryStore();
    vault = createVaultService(mem.store, { key, actor: { source: "mcp", clientId: "claude-client" } });
  });

  it("stores and returns a VAT number", async () => {
    await vault.updateField("vat_number", "123456789");
    const [field] = await vault.getProfile({ keys: ["vat_number"] });
    expect(field.display).toBe("GB123456789");
    expect(field.masked).toBe(false);
  });

  it("encrypts sensitive fields at rest and masks them on read", async () => {
    await vault.updateField("corporation_tax_utr", "1234567890");
    const row = mem.fields.get("corporation_tax_utr")!;
    expect(row.value).toBeNull();
    expect(row.value_encrypted).toMatch(/^v1\./);
    expect(row.value_encrypted).not.toContain("1234567890");

    const [masked] = await vault.getProfile({ keys: ["corporation_tax_utr"] });
    expect(masked).toMatchObject({ masked: true, value: null, display: "••••••7890" });

    const [revealed] = await vault.getProfile({ keys: ["corporation_tax_utr"], reveal: true });
    expect(revealed).toMatchObject({ masked: false, value: "1234567890" });
  });

  it("never writes sensitive values to the audit log", async () => {
    await vault.updateField("bank_account_number", "12345678");
    await vault.getProfile({ reveal: true });
    const auditText = JSON.stringify(mem.audit);
    expect(auditText).not.toContain("12345678");
    expect(mem.audit.map((a) => a.action)).toEqual(["vault.update_field", "vault.reveal_sensitive"]);
    expect(mem.audit[0]).toMatchObject({ source: "mcp", client_id: "claude-client", target: "bank_account_number", details: { sensitive: true } });
  });

  it("audits non-sensitive updates with the new value", async () => {
    await vault.updateField("company_number", "12345678");
    expect(mem.audit[0]).toMatchObject({ action: "vault.update_field", target: "company_number", details: { value: "12345678" } });
  });

  it("clears a field with an empty value", async () => {
    await vault.updateField("vat_number", "GB123456789");
    const res = await vault.updateField("vat_number", "");
    expect(res.cleared).toBe(true);
    expect(mem.fields.has("vat_number")).toBe(false);
    expect(mem.audit.at(-1)!.action).toBe("vault.clear_field");
  });

  it("rejects unknown fields and invalid values with a helpful message", async () => {
    await expect(vault.updateField("favourite_colour", "blue")).rejects.toBeInstanceOf(VaultError);
    await expect(vault.updateField("vat_number", "nope")).rejects.toThrow(/VAT number/);
  });

  it("seeds defaults once and never re-seeds cleared fields", async () => {
    const seeded = await vault.seedDefaults();
    expect(seeded).toContain("legal_name");
    expect(mem.fields.get("incorporation_date")!.value).toBe("2026-10-03");
    expect(mem.fields.has(SEED_MARKER)).toBe(true);

    await vault.updateField("trading_name", "");
    expect(await vault.seedDefaults()).toEqual([]);
    expect(mem.fields.has("trading_name")).toBe(false);
  });

  it("displays dates in UK format", async () => {
    await vault.seedDefaults();
    const [inc] = await vault.getProfile({ keys: ["incorporation_date"] });
    expect(inc.display).toBe("03/10/2026");
  });

  it("does not expose the internal seed marker as a field", async () => {
    await vault.seedDefaults();
    const profile = await vault.getProfile();
    expect(profile.find((p) => p.key === SEED_MARKER)).toBeUndefined();
  });

  it("adds items with UK dates and pence", async () => {
    const item = await vault.addItem({ kind: "insurance", name: "Professional indemnity", provider: "Hiscox", renewal_date: "03/10/2027", cost_pence: 42000, billing_period: "annual" });
    expect(item.renewal_date).toBe("2027-10-03");
    expect(vault.presentItem(item)).toMatchObject({ renewal_date: "03/10/2027", cost: "£420.00" });
    await expect(vault.addItem({ kind: "pets", name: "x" })).rejects.toBeInstanceOf(VaultError);
    await expect(vault.addItem({ kind: "insurance", name: "x", renewal_date: "2027/10/03" })).rejects.toThrow(/DD\/MM\/YYYY/);
  });

  it("only records documents inside the owner's folder that exist", async () => {
    const owner = "11111111-1111-1111-1111-111111111111";
    const doc = { name: "VAT certificate.pdf", category: "vat" as const, storage_path: `${owner}/abc-VAT.pdf`, mime_type: "application/pdf", size_bytes: 2048 };
    await expect(vault.recordDocument({ ...doc, storage_path: "someone-else/x.pdf" }, owner)).rejects.toThrow(/Invalid storage path/);
    await expect(vault.recordDocument(doc, owner)).rejects.toThrow(/not found/);
    mem.objects.add(doc.storage_path);
    const saved = await vault.recordDocument(doc, owner);
    const fetched = await vault.getDocument(saved.id);
    expect(fetched.download_url).toContain(doc.storage_path);
    expect(fetched.link_expires_in_minutes).toBe(10);
  });
});

describe("home summaries", () => {
  it("reports missing key fields", () => {
    const c = vaultCompleteness([
      { key: "legal_name", label: "Legal name", display: "Qevero Ltd" },
      { key: "vat_number", label: "VAT number", display: null },
      { key: "website", label: "Website", display: null },
    ]);
    expect(c).toEqual({ total: 2, filled: 1, missing: ["VAT number"] });
  });

  it("lists renewals due within 90 days, overdue first", () => {
    const base = { provider: null, reference: null, cost_pence: null, billing_period: null, notes: null, updated_at: "" };
    const items = [
      { ...base, id: "a", kind: "insurance" as const, name: "Later", renewal_date: "2027-06-01" },
      { ...base, id: "b", kind: "subscription" as const, name: "Soon", renewal_date: "2026-11-20" },
      { ...base, id: "c", kind: "subscription" as const, name: "Overdue", renewal_date: "2026-10-30" },
      { ...base, id: "d", kind: "supplier" as const, name: "None", renewal_date: null },
    ];
    const r = upcomingRenewals(items, "2026-11-01");
    expect(r.map((x) => [x.item.name, x.daysAway])).toEqual([
      ["Overdue", -2],
      ["Soon", 19],
    ]);
  });
});

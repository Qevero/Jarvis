import { describe, expect, it } from "vitest";
import { composeBriefing, journalPromptFor } from "@/lib/briefing/compose";
import { depositSplit, documentTotals, lineTotals, parsePounds } from "@/lib/invoicing/math";
import { blogDraftMarkdown, normaliseTags, slugify, themesOverTime, type JournalEntry } from "@/lib/journal/format";
import { batchConversations, parseClaudeExport } from "@/lib/knowledge/claude-export";
import { bankBalances, mapBankTransaction, mapCreditNote, mapInvoice, reportValue, xeroDate } from "@/lib/xero/map";
import { invoicePayload, purchaseOrderPayload, quotePayload } from "@/lib/xero/payloads";

describe("invoice maths", () => {
  it("rounds VAT per line like Xero", () => {
    expect(lineTotals({ description: "x", quantity: 3, unitPricePence: 3333 })).toEqual({ netPence: 9999, vatPence: 2000, grossPence: 11999 });
    expect(lineTotals({ description: "x", quantity: 1, unitPricePence: 1000, vat: "zero" }).vatPence).toBe(0);
  });
  it("totals documents with one-off/monthly split", () => {
    const t = documentTotals([
      { description: "Build", quantity: 1, unitPricePence: 450000 },
      { description: "SEO", quantity: 1, unitPricePence: 75000, billing: "monthly" },
      { description: "Domain", quantity: 1, unitPricePence: 1500, vat: "reduced" },
    ]);
    expect(t).toMatchObject({ netPence: 526500, vatPence: 105075, grossPence: 631575, oneOffNetPence: 451500, monthlyNetPence: 75000, firstYearNetPence: 1351500 });
    expect(t.vatByRate).toEqual({ standard: 105000, reduced: 75 });
  });
  it("parses pounds and deposits", () => {
    expect(parsePounds("£1,250.50")).toBe(125050);
    expect(parsePounds("12.345")).toBeNull();
    expect(parsePounds(9.99)).toBe(999);
    expect(depositSplit(450000, 50)).toEqual({ depositPence: 225000, balancePence: 225000 });
  });
});

describe("Xero payloads (always drafts)", () => {
  const lines = [{ description: "Website build", quantity: 1, unitPricePence: 450000, stream: "website_builds" }];
  it("builds a draft sales invoice with stream tracking", () => {
    const p = invoicePayload({ contact: { contactId: "c1" }, date: "2026-11-02", dueDate: "2026-11-16", lines, defaultAccount: "200", trackingAvailable: true });
    expect(p.Invoices[0]).toMatchObject({ Type: "ACCREC", Status: "DRAFT", LineAmountTypes: "Exclusive", Contact: { ContactID: "c1" } });
    expect(p.Invoices[0].LineItems[0]).toEqual({ Description: "Website build", Quantity: 1, UnitAmount: 4500, AccountCode: "200", TaxType: "OUTPUT2", Tracking: [{ Name: "Revenue Stream", Option: "Website Builds" }] });
  });
  it("omits tracking until the category exists, and requires a contact", () => {
    const p = invoicePayload({ contact: { name: "New Client", email: "a@b.com" }, date: "2026-11-02", dueDate: "2026-11-16", lines, defaultAccount: "200", trackingAvailable: false });
    expect(p.Invoices[0].LineItems[0].Tracking).toBeUndefined();
    expect(p.Invoices[0].Contact).toEqual({ Name: "New Client", EmailAddress: "a@b.com" });
    expect(() => invoicePayload({ contact: {}, date: "x", dueDate: "y", lines, defaultAccount: "200", trackingAvailable: false })).toThrow(/contact/);
  });
  it("builds draft quotes and purchase orders", () => {
    expect(quotePayload({ contact: { contactId: "c1" }, date: "2026-11-02", expiryDate: "2026-12-02", title: "Rebuild", lines, defaultAccount: "200", trackingAvailable: true }).Quotes[0]).toMatchObject({ Status: "DRAFT", Title: "Rebuild", ExpiryDate: "2026-12-02" });
    const po = purchaseOrderPayload({ contact: { contactId: "s1" }, date: "2026-11-02", lines: [{ description: "Stock photos", quantity: 2, unitPricePence: 2500 }], defaultAccount: "429" });
    expect(po.PurchaseOrders[0]).toMatchObject({ Status: "DRAFT" });
    expect(po.PurchaseOrders[0].LineItems[0]).toMatchObject({ TaxType: "INPUT2", AccountCode: "429", UnitAmount: 25 });
  });
});

describe("Xero mapping", () => {
  it("parses both Xero date formats", () => {
    expect(xeroDate("/Date(1793404800000+0000)/")).toBe("2026-10-31");
    expect(xeroDate("2026-10-03T00:00:00")).toBe("2026-10-03");
    expect(xeroDate(null)).toBeNull();
  });
  it("maps invoices with net amounts and the Revenue Stream option", () => {
    const { invoice, lines } = mapInvoice({
      InvoiceID: "i1", Type: "ACCREC", InvoiceNumber: "INV-0001", Status: "AUTHORISED", LineAmountTypes: "Inclusive",
      DateString: "2026-11-02T00:00:00", DueDateString: "2026-11-16T00:00:00", Contact: { ContactID: "c1", Name: "World of Beds" },
      SubTotal: 100, TotalTax: 20, Total: 120, AmountDue: 120, CurrencyCode: "GBP", CurrencyRate: 1, UpdatedDateUTC: "/Date(1793404800000+0000)/",
      LineItems: [{ LineItemID: "l1", Description: "SEO", Quantity: 1, UnitAmount: 120, LineAmount: 120, TaxAmount: 20, TaxType: "OUTPUT2", AccountCode: "200", Tracking: [{ Name: "Revenue Stream", Option: "SEO/GEO Retainers" }] }],
    });
    expect(invoice).toMatchObject({ invoice_id: "i1", number: "INV-0001", date: "2026-11-02", due_date: "2026-11-16", contact_name: "World of Beds", amount_due: 120 });
    expect(lines[0]).toMatchObject({ net_amount: 100, stream_option: "SEO/GEO Retainers", tax_type: "OUTPUT2" });
  });
  it("maps credit notes and bank transactions", () => {
    expect(mapCreditNote({ CreditNoteID: "cn1", Type: "ACCRECCREDIT", Status: "AUTHORISED", RemainingCredit: 50, LineItems: [] }).invoice).toMatchObject({ type: "ACCRECCREDIT", amount_due: 50 });
    expect(mapBankTransaction({ BankTransactionID: "b1", Type: "SPEND", IsReconciled: false, BankAccount: { Name: "Business Current" }, LineItems: [{ TaxAmount: 2, LineAmount: 12 }] })).toMatchObject({ bank_account: "Business Current", is_reconciled: false, lines: [{ TaxAmount: 2, LineAmount: 12 }] });
  });
  it("reads report figures", () => {
    const pl = { Reports: [{ Rows: [{ RowType: "Section", Rows: [{ RowType: "Row", Cells: [{ Value: "Total Income" }, { Value: "5000.00" }] }] }, { RowType: "Section", Rows: [{ RowType: "SummaryRow", Cells: [{ Value: "Net Profit" }, { Value: "1234.56" }] }] }] }] };
    expect(reportValue(pl, /^net profit$/i)).toBe(1234.56);
    const bank = { Reports: [{ Rows: [{ RowType: "Section", Rows: [{ RowType: "Row", Cells: [{ Value: "Business Current" }, { Value: "0" }, { Value: "0" }, { Value: "0" }, { Value: "8250.10" }] }, { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "8250.10" }] }] }] }] };
    expect(bankBalances(bank)).toEqual([{ account: "Business Current", closing: 8250.1 }]);
  });
});

describe("journal", () => {
  const entry: JournalEntry = {
    id: "1", entry_date: "2026-11-01", title: "Why we're productising SEO", raw_notes: "ramble", summary: "Retainers beat one-off work for cash flow.",
    themes: ["seo", "pricing"], decisions: ["Launch three SEO tiers"], ideas: ["Publish pricing on the site"], action_items: [{ text: "Draft tier copy" }], linked_clients: ["World of Beds"],
  };
  it("normalises tags and slugs", () => {
    expect(normaliseTags(["#SEO", " seo ", "Cash  Flow", ""])).toEqual(["seo", "cash flow"]);
    expect(slugify("Why we're productising SEO & GEO!")).toBe("why-we-re-productising-seo-and-geo");
  });
  it("exports a blog draft without client names by default", () => {
    const md = blogDraftMarkdown(entry);
    expect(md).toContain("slug: why-we-re-productising-seo");
    expect(md).toContain("## Ideas worth sharing");
    expect(md).toContain("status: draft");
    expect(md).not.toContain("World of Beds");
    expect(blogDraftMarkdown(entry, { includeClients: true })).toContain("World of Beds");
  });
  it("pivots themes over time", () => {
    const t = themesOverTime([
      { month: "2026-10", theme: "seo", entries: 2 },
      { month: "2026-11", theme: "seo", entries: 1 },
      { month: "2026-11", theme: "hiring", entries: 4 },
    ]);
    expect(t.themes).toEqual([{ theme: "hiring", total: 4 }, { theme: "seo", total: 3 }]);
    expect(t.months[0]).toEqual({ month: "2026-10", counts: { hiring: 0, seo: 2 } });
  });
});

describe("Claude export import", () => {
  const sample = [
    {
      uuid: "conv-1", name: "Pricing SEO retainers", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T11:00:00Z",
      chat_messages: [
        { uuid: "m1", sender: "human", created_at: "2026-09-01T10:00:00Z", text: "", content: [{ type: "text", text: "How should I price SEO?" }] },
        { uuid: "m2", sender: "assistant", created_at: "2026-09-01T10:01:00Z", text: "Tiered retainers…", content: [{ type: "tool_use", name: "x" }] },
        { uuid: "m3", sender: "human", text: "   ", content: [] },
      ],
    },
    { uuid: "conv-2", name: "", chat_messages: [] },
    { nope: true },
  ];
  it("keeps text messages only and skips empty chats", () => {
    const parsed = parseClaudeExport(sample);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ external_id: "conv-1", title: "Pricing SEO retainers", last_message_at: "2026-09-01T11:00:00.000Z" });
    expect(parsed[0].messages.map((m) => [m.sender, m.body])).toEqual([["human", "How should I price SEO?"], ["assistant", "Tiered retainers…"]]);
  });
  it("rejects files that aren't exports and batches by size", () => {
    expect(() => parseClaudeExport({ hello: 1 })).toThrow(/conversations.json/);
    const parsed = parseClaudeExport(sample);
    expect(batchConversations([...parsed, ...parsed, ...parsed], 400)).toHaveLength(3);
  });
});

describe("briefing", () => {
  it("composes a speakable briefing", () => {
    const b = composeBriefing({
      today: "2026-11-02", weekday: "Monday",
      calendar: [{ start: "2026-11-02T09:30:00", subject: "World of Beds call" }],
      tasksDue: [{ title: "Chase invoice", due: "2026-11-01", overdue: true }],
      flags: [{ severity: "high", title: "1 overdue invoice (£1,200.00)" }],
      deadlines: [{ title: "VAT return", due: "2027-02-07", daysAway: 97, verified: false }],
      cash: { total: 8000, accounts: [] }, setAside: { total: 1500 },
      revenue: { monthToDate: 1200, lastMonth: 4000, projected: 18000 },
    });
    expect(b.spoken).toContain("Good morning Jasper. It's Monday 02/11/2026.");
    expect(b.spoken).toContain("World of Beds call at 09:30");
    expect(b.sections.find((s) => s.id === "money")?.lines).toContain("Free cash after tax set-aside: £6,500.00.");
    expect(b.sections.find((s) => s.id === "deadlines")?.lines).toEqual(["No deadlines in the next 30 days."]);
    expect(journalPromptFor("2026-11-02")).toMatch(/\?$/);
  });
});

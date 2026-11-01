import { describe, expect, it } from "vitest";
import { estimateCorporationTax, projectProfit } from "@/lib/tax/ct";
import { ctAccountingPeriods, generateDeadlines, parseQuarterMonths, periodsOfAccount, vatPeriodContaining, vatPeriods, type TaxConfig } from "@/lib/tax/rules";
import { vatIssues, vatPosition } from "@/lib/tax/vat";
import type { BankTransactionRow } from "@/lib/revenue/types";
import { invoice, line } from "./fixtures";

/** Qevero Ltd as configured: incorporated and VAT registered 03/10/2026, year end 31/10, VAT quarters Mar/Jun/Sep/Dec. */
const qevero: TaxConfig = {
  incorporationDate: "2026-10-03",
  yearEnd: "31/10",
  vatRegistrationDate: "2026-10-03",
  vatQuarterEndMonths: [3, 6, 9, 12],
  includeSelfAssessment: false,
};

const due = (key: string) => generateDeadlines(qevero, "2026-10-01", "2029-12-31").find((d) => d.key === key)?.due;

describe("deadline rules (Qevero)", () => {
  it("parses VAT quarter months", () => {
    expect(parseQuarterMonths("Mar, Jun, Sep, Dec")).toEqual([3, 6, 9, 12]);
    expect(parseQuarterMonths("December, March, June, September")).toEqual([3, 6, 9, 12]);
    expect(parseQuarterMonths("3/6/9/12")).toEqual([3, 6, 9, 12]);
    expect(parseQuarterMonths("")).toEqual([]);
  });

  it("builds VAT periods from registration", () => {
    expect(vatPeriods(qevero, "2027-07-01").slice(0, 4)).toEqual([
      { start: "2026-10-03", end: "2026-12-31" },
      { start: "2027-01-01", end: "2027-03-31" },
      { start: "2027-04-01", end: "2027-06-30" },
      { start: "2027-07-01", end: "2027-09-30" },
    ]);
    expect(vatPeriodContaining(qevero, "2026-11-01")).toEqual({ start: "2026-10-03", end: "2026-12-31" });
  });

  it("honours a longer first VAT period from the certificate", () => {
    const cfg = { ...qevero, vatFirstPeriodEnd: "2027-03-31" };
    expect(vatPeriods(cfg, "2027-05-01").slice(0, 2)).toEqual([
      { start: "2026-10-03", end: "2027-03-31" },
      { start: "2027-04-01", end: "2027-06-30" },
    ]);
  });

  it("dates VAT returns 1 month + 7 days after quarter end", () => {
    expect(due("vat_return:2026-12-31")).toBe("2027-02-07");
    expect(due("vat_return:2027-03-31")).toBe("2027-05-07");
    expect(due("vat_return:2027-06-30")).toBe("2027-08-07");
    expect(due("vat_return:2027-09-30")).toBe("2027-11-07");
    // HMRC counts month end to month end: a quarter ending 30/06 is due 07/08.
    expect(due("vat_return:2028-06-30")).toBe("2028-08-07");
  });

  it("works out the first period of account (03/10/2026 – 31/10/2027)", () => {
    expect(periodsOfAccount(qevero, "2028-12-31")).toEqual([
      { start: "2026-10-03", end: "2027-10-31", first: true },
      { start: "2027-11-01", end: "2028-10-31", first: false },
      { start: "2028-11-01", end: "2029-10-31", first: false },
    ]);
  });

  it("splits the 13-month first period into two CT accounting periods", () => {
    expect(ctAccountingPeriods(qevero, "2028-01-01").map((p) => [p.start, p.end])).toEqual([
      ["2026-10-03", "2027-10-02"],
      ["2027-10-03", "2027-10-31"],
      ["2027-11-01", "2028-10-31"],
    ]);
  });

  it("dates CT payments 9 months + 1 day after each accounting period", () => {
    expect(due("ct_payment:2027-10-02")).toBe("2028-07-03");
    expect(due("ct_payment:2027-10-31")).toBe("2028-08-01");
    expect(due("ct_payment:2028-10-31")).toBe("2029-08-01");
  });

  it("dates both CT600s for the long first period 12 months after the period of account", () => {
    expect(due("ct600:2027-10-02")).toBe("2028-10-31");
    expect(due("ct600:2027-10-31")).toBe("2028-10-31");
    expect(due("ct600:2028-10-31")).toBe("2029-10-31");
  });

  it("dates Companies House accounts and confirmation statements", () => {
    expect(due("accounts:2027-10-31")).toBe("2028-07-03");
    expect(due("accounts:2028-10-31")).toBe("2029-07-31");
    expect(due("confirmation_statement:2027-10-03")).toBe("2027-10-17");
    expect(due("confirmation_statement:2028-10-03")).toBe("2028-10-17");
  });

  it("starts CT later if trading started later", () => {
    const cfg = { ...qevero, ctStartDate: "2026-11-01" };
    expect(ctAccountingPeriods(cfg, "2027-12-01").map((p) => [p.start, p.end])).toEqual([
      ["2026-11-01", "2027-10-31"],
      ["2027-11-01", "2028-10-31"],
    ]);
  });

  it("adds PAYE, Self Assessment and renewals when configured", () => {
    const cfg: TaxConfig = { ...qevero, payrollEnabled: true, includeSelfAssessment: true, renewals: [{ id: "pi", name: "Professional indemnity", kind: "insurance", renewalDate: "2027-10-03" }] };
    const list = generateDeadlines(cfg, "2026-11-01", "2027-12-31");
    expect(list.filter((d) => d.ruleId === "paye")[0]).toMatchObject({ due: "2026-11-22" });
    expect(list.find((d) => d.ruleId === "self_assessment")).toMatchObject({ due: "2027-01-31", personal: true });
    expect(list.find((d) => d.ruleId === "renewal")).toMatchObject({ due: "2027-10-03" });
  });

  it("returns deadlines sorted and within range", () => {
    const list = generateDeadlines(qevero, "2026-11-01", "2027-12-31");
    expect(list.map((d) => d.due)).toEqual([...list.map((d) => d.due)].sort());
    expect(list[0]).toMatchObject({ key: "vat_return:2026-12-31", due: "2027-02-07" });
    expect(list.every((d) => d.due >= "2026-11-01" && d.due <= "2027-12-31")).toBe(true);
  });
});

describe("VAT position", () => {
  const inv1 = invoice({ date: "2026-11-05", type: "ACCREC" });
  const inv2 = invoice({ date: "2026-11-20", type: "ACCREC", status: "DRAFT" });
  const cred = invoice({ date: "2026-12-01", type: "ACCRECCREDIT" });
  const bill = invoice({ date: "2026-11-10", type: "ACCPAY", has_attachments: false, contact_name: "Adobe" });
  const outside = invoice({ date: "2027-01-02", type: "ACCREC" });
  const lines = [
    line(inv1.invoice_id, 1000, { tax_amount: 200 }),
    line(inv2.invoice_id, 500, { tax_amount: 100 }),
    line(cred.invoice_id, 100, { tax_amount: 20 }),
    line(bill.invoice_id, 300, { tax_amount: 60, tax_type: "INPUT2", account_code: "463" }),
    line(outside.invoice_id, 999, { tax_amount: 199.8 }),
  ];
  const bank: BankTransactionRow[] = [
    { bank_transaction_id: "b1", type: "SPEND", status: "AUTHORISED", contact_name: "Train", date: "2026-11-15", reference: null, bank_account: "Business", is_reconciled: false, has_attachments: false, line_amount_types: "Inclusive", sub_total: 50, total_tax: 10, total: 60, lines: [{ Description: "Rail", TaxType: "INPUT2", TaxAmount: 10, LineAmount: 60 }] },
  ];
  const invoices = [inv1, inv2, cred, bill, outside];

  it("estimates the boxes for the quarter", () => {
    const p = vatPosition("2026-10-03", "2026-12-31", invoices, lines, bank);
    expect(p).toMatchObject({ box1OutputVat: 180, box4InputVat: 70, box5NetVat: 110, box6NetSales: 900, box7NetPurchases: 350, draftsExcluded: 1, salesInvoices: 2, bills: 1, bankTransactions: 1 });
  });

  it("lists readiness issues", () => {
    const issues = vatIssues("2026-10-03", "2026-12-31", invoices, [...lines, line(inv1.invoice_id, 50, { tax_type: null, tax_amount: 0 })], bank, { "200": "OUTPUT2" });
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("missing_vat_code");
    expect(kinds).toContain("bill_without_receipt");
    expect(kinds).toContain("unreconciled_bank");
    expect(kinds).toContain("draft_in_period");
    expect(issues[0].severity).toBe("high");
  });
});

describe("corporation tax estimate", () => {
  it("uses the small profits rate up to £50k", () => {
    expect(estimateCorporationTax(40_000, "2027-11-01", "2028-10-31")).toMatchObject({ band: "small", tax: 7600 });
  });
  it("applies marginal relief between £50k and £250k", () => {
    const e = estimateCorporationTax(100_000, "2027-11-01", "2028-10-31");
    expect(e.band).toBe("marginal");
    expect(e.marginalRelief).toBe(2250);
    expect(e.tax).toBe(22750);
  });
  it("uses the main rate above £250k and treats losses as nil", () => {
    expect(estimateCorporationTax(300_000, "2027-11-01", "2028-10-31").tax).toBe(75000);
    expect(estimateCorporationTax(-5000, "2027-11-01", "2028-10-31")).toMatchObject({ band: "loss", tax: 0 });
  });
  it("pro-rates limits for short periods and associated companies", () => {
    const short = estimateCorporationTax(10_000, "2027-10-03", "2027-10-31");
    expect(short.days).toBe(29);
    expect(short.lowerLimit).toBe(3972.6);
    expect(short.band).toBe("marginal");
    expect(estimateCorporationTax(40_000, "2027-11-01", "2028-10-31", 1).lowerLimit).toBe(25000);
  });
  it("projects profit to the full period", () => {
    expect(projectProfit(10_000, "2026-11-01", "2027-10-31", "2027-01-30")).toBe(40109.89);
  });
});

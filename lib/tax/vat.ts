import { inRange } from "@/lib/periods";
import { round2 } from "@/lib/revenue/analytics";
import { POSTED, type BankTransactionRow, type InvoiceRow, type LineRow } from "@/lib/revenue/types";

/**
 * VAT position estimate for a period from mirrored Xero data (standard
 * accrual scheme: tax point = invoice date). An estimate for planning; the
 * figures Xero produces for the MTD return are authoritative.
 */

const OUT_OF_SCOPE = new Set(["NONE", "", null as unknown as string]);
const SALES_TYPES = new Set(["ACCREC", "ACCRECCREDIT"]);

export type VatPosition = {
  periodStart: string;
  periodEnd: string;
  box1OutputVat: number;
  box4InputVat: number;
  box5NetVat: number;
  box6NetSales: number;
  box7NetPurchases: number;
  salesInvoices: number;
  bills: number;
  bankTransactions: number;
  draftsExcluded: number;
};

export function vatPosition(
  periodStart: string,
  periodEnd: string,
  invoices: InvoiceRow[],
  lines: LineRow[],
  bank: BankTransactionRow[] = [],
): VatPosition {
  const linesBy = new Map<string, LineRow[]>();
  for (const l of lines) linesBy.set(l.invoice_id, [...(linesBy.get(l.invoice_id) ?? []), l]);

  let out = 0, inp = 0, sales = 0, purchases = 0, nSales = 0, nBills = 0, drafts = 0;
  for (const i of invoices) {
    if (!inRange(i.date, periodStart, periodEnd)) continue;
    if (!POSTED.has(i.status)) {
      if (i.status === "DRAFT" || i.status === "SUBMITTED") drafts++;
      continue;
    }
    const rate = Number(i.currency_rate) > 0 ? Number(i.currency_rate) : 1;
    const sign = i.type.endsWith("CREDIT") ? -1 : 1;
    const isSales = SALES_TYPES.has(i.type);
    isSales ? nSales++ : nBills++;
    for (const l of linesBy.get(i.invoice_id) ?? []) {
      const tax = (sign * Number(l.tax_amount)) / rate;
      const net = (sign * Number(l.net_amount)) / rate;
      const inScope = !OUT_OF_SCOPE.has(l.tax_type ?? "");
      if (isSales) {
        out += tax;
        if (inScope) sales += net;
      } else {
        inp += tax;
        if (inScope) purchases += net;
      }
    }
  }

  let nBank = 0;
  for (const t of bank) {
    if (!inRange(t.date, periodStart, periodEnd) || t.status === "DELETED" || t.status === "VOIDED") continue;
    const isReceive = t.type.startsWith("RECEIVE");
    const isSpend = t.type.startsWith("SPEND");
    if (!isReceive && !isSpend) continue;
    nBank++;
    const inclusive = (t.line_amount_types ?? "").toLowerCase() === "inclusive";
    for (const l of t.lines ?? []) {
      const tax = Number(l.TaxAmount ?? 0);
      const lineAmount = Number(l.LineAmount ?? 0);
      const net = inclusive ? lineAmount - tax : lineAmount;
      const inScope = !OUT_OF_SCOPE.has(l.TaxType ?? "");
      if (isReceive) {
        out += tax;
        if (inScope) sales += net;
      } else {
        inp += tax;
        if (inScope) purchases += net;
      }
    }
  }

  return {
    periodStart,
    periodEnd,
    box1OutputVat: round2(out),
    box4InputVat: round2(inp),
    box5NetVat: round2(out - inp),
    box6NetSales: Math.round(sales),
    box7NetPurchases: Math.round(purchases),
    salesInvoices: nSales,
    bills: nBills,
    bankTransactions: nBank,
    draftsExcluded: drafts,
  };
}

export type VatIssue = { kind: "missing_vat_code" | "bill_without_receipt" | "unreconciled_bank" | "draft_in_period" | "zero_vat_on_standard_account"; severity: "high" | "medium" | "low"; reference: string; detail: string; date: string | null; amount: number };

/** Readiness checks for a VAT period. `accountTaxTypes` maps account code → default tax type from the chart of accounts. */
export function vatIssues(
  periodStart: string,
  periodEnd: string,
  invoices: InvoiceRow[],
  lines: LineRow[],
  bank: BankTransactionRow[],
  accountTaxTypes: Record<string, string> = {},
): VatIssue[] {
  const issues: VatIssue[] = [];
  const inv = new Map(invoices.map((i) => [i.invoice_id, i]));

  for (const l of lines) {
    const i = inv.get(l.invoice_id);
    if (!i || !inRange(i.date, periodStart, periodEnd) || !POSTED.has(i.status)) continue;
    const ref = `${i.type === "ACCPAY" ? "Bill" : "Invoice"} ${i.number ?? i.reference ?? i.invoice_id.slice(0, 8)} (${i.contact_name ?? "?"})`;
    const def = l.account_code ? accountTaxTypes[l.account_code] : undefined;
    if (!l.tax_type) {
      issues.push({ kind: "missing_vat_code", severity: "high", reference: ref, detail: `Line "${l.description ?? ""}" has no VAT code.`, date: i.date, amount: Number(l.line_amount) });
    } else if (l.tax_type === "NONE" && def && def !== "NONE") {
      issues.push({ kind: "zero_vat_on_standard_account", severity: "medium", reference: ref, detail: `Line "${l.description ?? ""}" is "No VAT" but account ${l.account_code} normally uses ${def}. Check it's right.`, date: i.date, amount: Number(l.line_amount) });
    }
  }

  for (const i of invoices) {
    if (!inRange(i.date, periodStart, periodEnd)) continue;
    if (i.type === "ACCPAY" && POSTED.has(i.status) && !i.has_attachments) {
      issues.push({ kind: "bill_without_receipt", severity: "medium", reference: `Bill ${i.number ?? i.reference ?? ""} (${i.contact_name ?? "?"})`, detail: "No receipt or invoice attached in Xero.", date: i.date, amount: Number(i.total) });
    }
    if ((i.type === "ACCREC" || i.type === "ACCPAY") && (i.status === "DRAFT" || i.status === "SUBMITTED")) {
      issues.push({ kind: "draft_in_period", severity: "low", reference: `${i.type === "ACCREC" ? "Invoice" : "Bill"} ${i.number ?? "(draft)"} (${i.contact_name ?? "?"})`, detail: `Still ${i.status.toLowerCase()}, so it isn't in the VAT figures yet.`, date: i.date, amount: Number(i.total) });
    }
  }

  for (const t of bank) {
    if (!inRange(t.date, periodStart, periodEnd) || t.status === "DELETED" || t.status === "VOIDED") continue;
    if (!t.is_reconciled) {
      issues.push({ kind: "unreconciled_bank", severity: "medium", reference: `${t.bank_account ?? "Bank"}: ${t.contact_name ?? t.reference ?? t.type}`, detail: "Bank transaction not reconciled.", date: t.date, amount: Number(t.total) });
    }
    if (t.type.startsWith("SPEND") && !t.has_attachments) {
      issues.push({ kind: "bill_without_receipt", severity: "low", reference: `Spend money: ${t.contact_name ?? t.reference ?? ""}`, detail: "No receipt attached.", date: t.date, amount: Number(t.total) });
    }
    for (const l of t.lines ?? []) {
      if (!l.TaxType) issues.push({ kind: "missing_vat_code", severity: "high", reference: `Bank: ${t.contact_name ?? t.reference ?? ""}`, detail: `Line "${l.Description ?? ""}" has no VAT code.`, date: t.date, amount: Number(l.LineAmount ?? 0) });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.date ?? "").localeCompare(b.date ?? ""));
}

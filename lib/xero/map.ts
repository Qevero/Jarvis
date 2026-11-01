import type { InvoiceType } from "@/lib/revenue/types";
import { TRACKING_CATEGORY_NAME } from "@/lib/revenue/streams";

/** Map Xero Accounting API JSON to Jarvis's mirror rows. Pure; tested with fixtures. */

type J = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0);

/** Xero dates come as "/Date(1696291200000+0000)/" or ISO "2026-10-03T00:00:00". Returns YYYY-MM-DD. */
export function xeroDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const ms = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(v);
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return isoMatch ? isoMatch[1] : null;
}

export function xeroTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const ms = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(v);
  if (ms) return new Date(Number(ms[1])).toISOString();
  const t = Date.parse(v.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function streamOption(tracking: unknown): string | null {
  if (!Array.isArray(tracking)) return null;
  const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const hit = tracking.find((t: J) => norm(t.Name) === norm(TRACKING_CATEGORY_NAME));
  return hit ? str((hit as J).Option) : null;
}

function mapLines(docId: string, lineItems: unknown, lineAmountTypes: string | null) {
  const inclusive = (lineAmountTypes ?? "").toLowerCase() === "inclusive";
  return (Array.isArray(lineItems) ? lineItems : []).map((li: J, idx: number) => {
    const lineAmount = num(li.LineAmount);
    const tax = num(li.TaxAmount);
    const tracking = Array.isArray(li.Tracking) ? (li.Tracking as J[]).map((t) => ({ Name: str(t.Name) ?? undefined, Option: str(t.Option) ?? undefined })) : [];
    return {
      invoice_id: docId,
      line_item_id: str(li.LineItemID) ?? `${docId}-${idx}`,
      position: idx,
      description: str(li.Description),
      quantity: li.Quantity === undefined ? null : num(li.Quantity),
      unit_amount: li.UnitAmount === undefined ? null : num(li.UnitAmount),
      account_code: str(li.AccountCode),
      tax_type: str(li.TaxType),
      tax_amount: tax,
      line_amount: lineAmount,
      net_amount: Math.round((inclusive ? lineAmount - tax : lineAmount) * 100) / 100,
      tracking,
      stream_option: streamOption(li.Tracking),
    };
  });
}

export function mapInvoice(inv: J) {
  const id = String(inv.InvoiceID);
  const type = String(inv.Type) as InvoiceType;
  const contact = (inv.Contact ?? {}) as J;
  const lat = str(inv.LineAmountTypes);
  return {
    invoice: {
      invoice_id: id,
      type,
      number: str(inv.InvoiceNumber),
      reference: str(inv.Reference),
      contact_id: str(contact.ContactID),
      contact_name: str(contact.Name),
      status: String(inv.Status ?? "DRAFT"),
      date: xeroDate(inv.DateString ?? inv.Date),
      due_date: xeroDate(inv.DueDateString ?? inv.DueDate),
      fully_paid_on: xeroDate(inv.FullyPaidOnDate),
      currency_code: str(inv.CurrencyCode) ?? "GBP",
      currency_rate: num(inv.CurrencyRate) || 1,
      line_amount_types: lat,
      sub_total: num(inv.SubTotal),
      total_tax: num(inv.TotalTax),
      total: num(inv.Total),
      amount_due: num(inv.AmountDue),
      amount_paid: num(inv.AmountPaid),
      has_attachments: Boolean(inv.HasAttachments),
      repeating_invoice_id: str(inv.RepeatingInvoiceID),
      sent_to_contact: typeof inv.SentToContact === "boolean" ? inv.SentToContact : null,
      updated_utc: xeroTimestamp(inv.UpdatedDateUTC),
    },
    lines: mapLines(id, inv.LineItems, lat),
  };
}

/** Credit notes are stored alongside invoices (type ACCRECCREDIT / ACCPAYCREDIT). */
export function mapCreditNote(cn: J) {
  const id = String(cn.CreditNoteID);
  const contact = (cn.Contact ?? {}) as J;
  const lat = str(cn.LineAmountTypes);
  return {
    invoice: {
      invoice_id: id,
      type: String(cn.Type) as InvoiceType,
      number: str(cn.CreditNoteNumber),
      reference: str(cn.Reference),
      contact_id: str(contact.ContactID),
      contact_name: str(contact.Name),
      status: String(cn.Status ?? "DRAFT"),
      date: xeroDate(cn.DateString ?? cn.Date),
      due_date: null,
      fully_paid_on: xeroDate(cn.FullyPaidOnDate),
      currency_code: str(cn.CurrencyCode) ?? "GBP",
      currency_rate: num(cn.CurrencyRate) || 1,
      line_amount_types: lat,
      sub_total: num(cn.SubTotal),
      total_tax: num(cn.TotalTax),
      total: num(cn.Total),
      amount_due: num(cn.RemainingCredit),
      amount_paid: 0,
      has_attachments: Boolean(cn.HasAttachments),
      repeating_invoice_id: null,
      sent_to_contact: typeof cn.SentToContact === "boolean" ? cn.SentToContact : null,
      updated_utc: xeroTimestamp(cn.UpdatedDateUTC),
    },
    lines: mapLines(id, cn.LineItems, lat),
  };
}

export function mapBankTransaction(t: J) {
  const contact = (t.Contact ?? {}) as J;
  const account = (t.BankAccount ?? {}) as J;
  return {
    bank_transaction_id: String(t.BankTransactionID),
    type: String(t.Type),
    status: str(t.Status),
    contact_name: str(contact.Name),
    date: xeroDate(t.DateString ?? t.Date),
    reference: str(t.Reference),
    bank_account: str(account.Name) ?? str(account.Code),
    is_reconciled: Boolean(t.IsReconciled),
    has_attachments: Boolean(t.HasAttachments),
    line_amount_types: str(t.LineAmountTypes),
    sub_total: num(t.SubTotal),
    total_tax: num(t.TotalTax),
    total: num(t.Total),
    lines: (Array.isArray(t.LineItems) ? t.LineItems : []).map((l: J) => ({
      Description: str(l.Description) ?? undefined,
      AccountCode: str(l.AccountCode) ?? undefined,
      TaxType: str(l.TaxType) ?? undefined,
      TaxAmount: num(l.TaxAmount),
      LineAmount: num(l.LineAmount),
    })),
    updated_utc: xeroTimestamp(t.UpdatedDateUTC),
  };
}

export function mapContact(c: J) {
  return {
    contact_id: String(c.ContactID),
    name: String(c.Name ?? "Unnamed"),
    email: str(c.EmailAddress),
    is_customer: Boolean(c.IsCustomer),
    is_supplier: Boolean(c.IsSupplier),
    status: str(c.ContactStatus),
    updated_utc: xeroTimestamp(c.UpdatedDateUTC),
  };
}

export function mapAccount(a: J) {
  return {
    account_id: String(a.AccountID),
    code: str(a.Code),
    name: String(a.Name ?? ""),
    type: str(a.Type),
    class: str(a.Class),
    tax_type: str(a.TaxType),
    status: str(a.Status),
  };
}

/** Pull a single figure row (e.g. "Net Profit") out of a Xero report. */
export function reportValue(report: J, title: RegExp): number | null {
  const reports = (report.Reports as J[] | undefined) ?? [];
  const rows = (reports[0]?.Rows as J[] | undefined) ?? [];
  const walk = (rs: J[]): number | null => {
    for (const r of rs) {
      const cells = (r.Cells as J[] | undefined) ?? [];
      if (cells.length >= 2 && title.test(String(cells[0].Value ?? ""))) return num(cells[1].Value);
      if (Array.isArray(r.Rows)) {
        const v = walk(r.Rows as J[]);
        if (v !== null) return v;
      }
    }
    return null;
  };
  return walk(rows);
}

/** Bank balances from the BankSummary report: [{ account, closing }]. */
export function bankBalances(report: J): { account: string; closing: number }[] {
  const reports = (report.Reports as J[] | undefined) ?? [];
  const out: { account: string; closing: number }[] = [];
  for (const section of (reports[0]?.Rows as J[] | undefined) ?? []) {
    for (const r of (section.Rows as J[] | undefined) ?? []) {
      if (r.RowType !== "Row") continue;
      const cells = (r.Cells as J[]) ?? [];
      const name = String(cells[0]?.Value ?? "");
      if (!name || /^total/i.test(name)) continue;
      out.push({ account: name, closing: num(cells[cells.length - 1]?.Value) });
    }
  }
  return out;
}

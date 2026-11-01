import type { InvoiceRow, LineRow } from "@/lib/revenue/types";

let n = 0;
export function invoice(p: Partial<InvoiceRow> & { date: string | null }): InvoiceRow {
  n++;
  return {
    invoice_id: p.invoice_id ?? `inv-${n}`,
    type: p.type ?? "ACCREC",
    number: p.number ?? `INV-${String(n).padStart(4, "0")}`,
    reference: null,
    contact_id: p.contact_id ?? "c-acme",
    contact_name: p.contact_name ?? "Acme",
    status: p.status ?? "AUTHORISED",
    date: p.date,
    due_date: p.due_date ?? null,
    fully_paid_on: p.fully_paid_on ?? null,
    currency_code: "GBP",
    currency_rate: p.currency_rate ?? 1,
    line_amount_types: "Exclusive",
    sub_total: p.sub_total ?? 0,
    total_tax: p.total_tax ?? 0,
    total: p.total ?? 0,
    amount_due: p.amount_due ?? 0,
    amount_paid: 0,
    has_attachments: p.has_attachments ?? false,
    repeating_invoice_id: p.repeating_invoice_id ?? null,
  };
}

export function line(invoiceId: string, net: number, p: Partial<LineRow> = {}): LineRow {
  n++;
  return {
    invoice_id: invoiceId,
    line_item_id: p.line_item_id ?? `l-${n}`,
    position: 0,
    description: p.description ?? "Work",
    quantity: 1,
    unit_amount: net,
    account_code: p.account_code ?? "200",
    tax_type: p.tax_type === undefined ? "OUTPUT2" : p.tax_type,
    tax_amount: p.tax_amount ?? Math.round(net * 20) / 100,
    line_amount: net,
    net_amount: net,
    tracking: [],
    stream_option: p.stream_option ?? null,
  };
}

/** Build an invoice with one line in a stream. */
export function sale(date: string, net: number, stream: string | null, p: Partial<Omit<InvoiceRow, "date">> = {}) {
  const inv = invoice({ date, sub_total: net, total_tax: net * 0.2, total: net * 1.2, ...p });
  return { inv, lines: [line(inv.invoice_id, net, { stream_option: stream })] };
}

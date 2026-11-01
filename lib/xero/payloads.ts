import { TRACKING_CATEGORY_NAME, streamLabel, isStreamId } from "@/lib/revenue/streams";
import { VAT_RATES, type DraftLine } from "@/lib/invoicing/math";

/**
 * Request bodies for documents Jarvis creates in Xero. Everything is created
 * as a DRAFT: Jasper reviews, approves and sends in Xero himself.
 */

export type DocContact = { contactId?: string | null; name?: string | null; email?: string | null };

function contactRef(c: DocContact) {
  if (c.contactId) return { ContactID: c.contactId };
  if (c.name) return { Name: c.name, ...(c.email ? { EmailAddress: c.email } : {}) };
  throw new Error("A contact (Xero ContactID or name) is required.");
}

function lineItem(l: DraftLine, side: "sales" | "purchase", defaultAccount: string, trackingAvailable: boolean) {
  const vat = VAT_RATES[l.vat ?? "standard"];
  const item: Record<string, unknown> = {
    Description: l.description,
    Quantity: l.quantity,
    UnitAmount: Math.round(l.unitPricePence) / 100,
    AccountCode: l.accountCode || defaultAccount,
    TaxType: side === "sales" ? vat.salesTaxType : vat.purchaseTaxType,
  };
  if (side === "sales" && trackingAvailable && l.stream && isStreamId(l.stream)) {
    item.Tracking = [{ Name: TRACKING_CATEGORY_NAME, Option: streamLabel(l.stream) }];
  }
  return item;
}

export type InvoiceDraftInput = {
  contact: DocContact;
  date: string;
  dueDate: string;
  reference?: string | null;
  lines: DraftLine[];
  defaultAccount: string;
  trackingAvailable: boolean;
};

export function invoicePayload(i: InvoiceDraftInput) {
  if (!i.lines.length) throw new Error("An invoice needs at least one line.");
  return {
    Invoices: [
      {
        Type: "ACCREC",
        Status: "DRAFT",
        Contact: contactRef(i.contact),
        Date: i.date,
        DueDate: i.dueDate,
        LineAmountTypes: "Exclusive",
        ...(i.reference ? { Reference: i.reference } : {}),
        LineItems: i.lines.map((l) => lineItem(l, "sales", i.defaultAccount, i.trackingAvailable)),
      },
    ],
  };
}

export type QuoteDraftInput = InvoiceDraftInput & { title?: string | null; summary?: string | null; terms?: string | null; expiryDate?: string | null };

export function quotePayload(q: Omit<QuoteDraftInput, "dueDate"> & { dueDate?: string }) {
  if (!q.lines.length) throw new Error("A quote needs at least one line.");
  return {
    Quotes: [
      {
        Status: "DRAFT",
        Contact: contactRef(q.contact),
        Date: q.date,
        ...(q.expiryDate ? { ExpiryDate: q.expiryDate } : {}),
        ...(q.title ? { Title: q.title.slice(0, 100) } : {}),
        ...(q.summary ? { Summary: q.summary.slice(0, 3000) } : {}),
        ...(q.terms ? { Terms: q.terms.slice(0, 4000) } : {}),
        ...(q.reference ? { Reference: q.reference } : {}),
        LineAmountTypes: "EXCLUSIVE",
        LineItems: q.lines.map((l) => lineItem(l, "sales", q.defaultAccount, q.trackingAvailable)),
      },
    ],
  };
}

export type PurchaseOrderDraftInput = {
  contact: DocContact;
  date: string;
  deliveryDate?: string | null;
  reference?: string | null;
  deliveryInstructions?: string | null;
  lines: DraftLine[];
  defaultAccount: string;
};

export function purchaseOrderPayload(p: PurchaseOrderDraftInput) {
  if (!p.lines.length) throw new Error("A purchase order needs at least one line.");
  return {
    PurchaseOrders: [
      {
        Status: "DRAFT",
        Contact: contactRef(p.contact),
        Date: p.date,
        ...(p.deliveryDate ? { DeliveryDate: p.deliveryDate } : {}),
        ...(p.reference ? { Reference: p.reference } : {}),
        ...(p.deliveryInstructions ? { DeliveryInstructions: p.deliveryInstructions } : {}),
        LineAmountTypes: "Exclusive",
        LineItems: p.lines.map((l) => lineItem(l, "purchase", p.defaultAccount, false)),
      },
    ],
  };
}

export function contactPayload(c: { name: string; email?: string | null; isSupplier?: boolean }) {
  return { Contacts: [{ Name: c.name, ...(c.email ? { EmailAddress: c.email } : {}) }] };
}

/** The "Revenue Stream" tracking category with Qevero's five options. */
export function trackingCategoryPayload() {
  return { Name: TRACKING_CATEGORY_NAME };
}

import { audit, getPrefs, UserError, type Ctx } from "@/lib/ctx";
import { documentTotals, type DraftLine } from "@/lib/invoicing/math";
import { addDays } from "@/lib/periods";
import { todayUk } from "@/lib/dates";
import { STREAMS, TRACKING_CATEGORY_NAME } from "@/lib/revenue/streams";
import { XeroClient } from "./client";
import { mapContact, mapInvoice } from "./map";
import { contactPayload, invoicePayload, purchaseOrderPayload, quotePayload, type DocContact } from "./payloads";
import { trackingCategoryExists } from "./sync";

/**
 * Write actions in Xero. Everything is created as a DRAFT — Jarvis never
 * approves, sends or emails a document. Every write is audited.
 */

type J = Record<string, unknown>;

/** Resolve a contact by Xero id, exact/partial name in the mirror, or create it. */
export async function resolveContact(ctx: Ctx, c: DocContact & { createIfMissing?: boolean; supplier?: boolean }): Promise<{ contactId: string; name: string; created: boolean }> {
  if (c.contactId) {
    const { data } = await ctx.sb.from("xero_contacts").select("contact_id, name").eq("owner_id", ctx.ownerId).eq("contact_id", c.contactId).maybeSingle();
    return { contactId: c.contactId, name: data?.name ?? c.name ?? "Contact", created: false };
  }
  if (!c.name) throw new UserError("Say who the document is for (a Xero contact name).");
  const { data: matches } = await ctx.sb.from("xero_contacts").select("contact_id, name").eq("owner_id", ctx.ownerId).ilike("name", `%${c.name.replace(/[%_]/g, "")}%`).limit(5);
  const exact = matches?.find((m) => m.name.toLowerCase() === c.name!.toLowerCase());
  if (exact) return { contactId: exact.contact_id, name: exact.name, created: false };
  if (matches && matches.length === 1) return { contactId: matches[0].contact_id, name: matches[0].name, created: false };
  if (matches && matches.length > 1) throw new UserError(`Several Xero contacts match "${c.name}": ${matches.map((m) => m.name).join(", ")}. Which one?`);
  if (!c.createIfMissing) throw new UserError(`No Xero contact called "${c.name}". Confirm and pass create_contact=true to create it.`);
  const xero = new XeroClient(ctx);
  const body = await xero.json<{ Contacts: J[] }>("/Contacts", { method: "PUT", body: contactPayload({ name: c.name, email: c.email }) });
  const created = mapContact(body.Contacts[0]);
  await ctx.sb.from("xero_contacts").upsert({ ...created, owner_id: ctx.ownerId, is_supplier: Boolean(c.supplier), is_customer: !c.supplier }, { onConflict: "owner_id,contact_id" });
  await ctx.sb.from("xero_documents").insert({ owner_id: ctx.ownerId, kind: "contact", xero_id: created.contact_id, contact_name: created.name });
  await audit(ctx, "xero.create_contact", created.contact_id, { name: created.name });
  return { contactId: created.contact_id, name: created.name, created: true };
}

function validateLines(lines: DraftLine[]) {
  if (!lines.length) throw new UserError("Add at least one line.");
  for (const l of lines) {
    if (!l.description?.trim()) throw new UserError("Every line needs a description.");
    if (!(l.quantity > 0)) throw new UserError("Quantities must be above zero.");
    if (!Number.isFinite(l.unitPricePence) || l.unitPricePence < 0) throw new UserError("Prices must be zero or more.");
  }
}

export async function createInvoiceDraft(ctx: Ctx, input: { contact: DocContact & { createIfMissing?: boolean }; lines: DraftLine[]; date?: string; dueDate?: string; reference?: string | null; proposalId?: string | null }) {
  validateLines(input.lines);
  const prefs = await getPrefs(ctx);
  const contact = await resolveContact(ctx, input.contact);
  const date = input.date ?? todayUk();
  const dueDate = input.dueDate ?? addDays(date, prefs.paymentTermsDays);
  const trackingAvailable = await trackingCategoryExists(ctx);
  const xero = new XeroClient(ctx);
  const body = await xero.json<{ Invoices: J[] }>("/Invoices", {
    method: "PUT",
    body: invoicePayload({ contact: { contactId: contact.contactId }, date, dueDate, reference: input.reference, lines: input.lines, defaultAccount: prefs.defaultSalesAccount, trackingAvailable }),
  });
  const mapped = mapInvoice(body.Invoices[0]);
  await ctx.sb.from("xero_invoices").upsert({ ...mapped.invoice, owner_id: ctx.ownerId }, { onConflict: "owner_id,invoice_id" });
  if (mapped.lines.length) await ctx.sb.from("xero_invoice_lines").upsert(mapped.lines.map((l) => ({ ...l, owner_id: ctx.ownerId })), { onConflict: "owner_id,invoice_id,line_item_id" });
  await ctx.sb.from("xero_documents").insert({ owner_id: ctx.ownerId, kind: "invoice", xero_id: mapped.invoice.invoice_id, number: mapped.invoice.number, contact_name: contact.name, total: mapped.invoice.total, status: "DRAFT", proposal_id: input.proposalId ?? null });
  await audit(ctx, "xero.create_invoice_draft", mapped.invoice.invoice_id, { contact: contact.name, total: mapped.invoice.total, lines: input.lines.length });
  const totals = documentTotals(input.lines);
  return {
    invoiceId: mapped.invoice.invoice_id,
    number: mapped.invoice.number,
    contact: contact.name,
    contactCreated: contact.created,
    date,
    dueDate,
    netPence: totals.netPence,
    vatPence: totals.vatPence,
    grossPence: totals.grossPence,
    status: "DRAFT",
    xeroUrl: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${mapped.invoice.invoice_id}`,
    trackingApplied: trackingAvailable,
  };
}

export async function createQuoteDraft(ctx: Ctx, input: { contact: DocContact & { createIfMissing?: boolean }; lines: DraftLine[]; date?: string; expiryDate?: string | null; title?: string | null; summary?: string | null; terms?: string | null; reference?: string | null; proposalId?: string | null }) {
  validateLines(input.lines);
  const prefs = await getPrefs(ctx);
  const contact = await resolveContact(ctx, input.contact);
  const date = input.date ?? todayUk();
  const xero = new XeroClient(ctx);
  const body = await xero.json<{ Quotes: J[] }>("/Quotes", {
    method: "PUT",
    body: quotePayload({ contact: { contactId: contact.contactId }, date, expiryDate: input.expiryDate ?? addDays(date, 30), title: input.title, summary: input.summary, terms: input.terms, reference: input.reference, lines: input.lines, defaultAccount: prefs.defaultSalesAccount, trackingAvailable: await trackingCategoryExists(ctx) }),
  });
  const q = body.Quotes[0];
  const id = String(q.QuoteID);
  await ctx.sb.from("xero_documents").insert({ owner_id: ctx.ownerId, kind: "quote", xero_id: id, number: (q.QuoteNumber as string) ?? null, contact_name: contact.name, total: Number(q.Total ?? 0), status: "DRAFT", proposal_id: input.proposalId ?? null });
  await audit(ctx, "xero.create_quote_draft", id, { contact: contact.name, total: q.Total });
  return { quoteId: id, number: (q.QuoteNumber as string) ?? null, contact: contact.name, total: Number(q.Total ?? 0), status: "DRAFT", xeroUrl: `https://go.xero.com/Accounts/Receivable/Quotes/View/${id}` };
}

export async function createPurchaseOrderDraft(ctx: Ctx, input: { contact: DocContact & { createIfMissing?: boolean }; lines: DraftLine[]; date?: string; deliveryDate?: string | null; reference?: string | null; deliveryInstructions?: string | null }) {
  validateLines(input.lines);
  const prefs = await getPrefs(ctx);
  const contact = await resolveContact(ctx, { ...input.contact, supplier: true });
  const xero = new XeroClient(ctx);
  const body = await xero.json<{ PurchaseOrders: J[] }>("/PurchaseOrders", {
    method: "PUT",
    body: purchaseOrderPayload({ contact: { contactId: contact.contactId }, date: input.date ?? todayUk(), deliveryDate: input.deliveryDate, reference: input.reference, deliveryInstructions: input.deliveryInstructions, lines: input.lines, defaultAccount: prefs.defaultPurchaseAccount }),
  });
  const po = body.PurchaseOrders[0];
  const id = String(po.PurchaseOrderID);
  await ctx.sb.from("xero_documents").insert({ owner_id: ctx.ownerId, kind: "purchase_order", xero_id: id, number: (po.PurchaseOrderNumber as string) ?? null, contact_name: contact.name, total: Number(po.Total ?? 0), status: "DRAFT" });
  await audit(ctx, "xero.create_purchase_order_draft", id, { supplier: contact.name, total: po.Total });
  return { purchaseOrderId: id, number: (po.PurchaseOrderNumber as string) ?? null, supplier: contact.name, total: Number(po.Total ?? 0), status: "DRAFT", xeroUrl: `https://go.xero.com/Accounts/Payable/PurchaseOrders/View/${id}` };
}

/** Recent purchase orders and quotes, straight from Xero (2 calls). */
export async function listQuotesAndPOs(ctx: Ctx) {
  const xero = new XeroClient(ctx);
  const [quotes, pos] = await Promise.all([
    xero.json<{ Quotes?: J[] }>("/Quotes", { query: { page: 1 } }),
    xero.json<{ PurchaseOrders?: J[] }>("/PurchaseOrders", { query: { page: 1 } }),
  ]);
  return {
    quotes: (quotes.Quotes ?? []).slice(0, 30).map((q) => ({ id: q.QuoteID, number: q.QuoteNumber, contact: (q.Contact as J)?.Name, status: q.Status, total: q.Total, date: q.DateString, expiry: q.ExpiryDateString, title: q.Title })),
    purchaseOrders: (pos.PurchaseOrders ?? []).slice(0, 30).map((p) => ({ id: p.PurchaseOrderID, number: p.PurchaseOrderNumber, contact: (p.Contact as J)?.Name, status: p.Status, total: p.Total, date: p.DateString })),
  };
}

export async function invoicePdf(ctx: Ctx, invoiceId: string): Promise<ArrayBuffer> {
  const xero = new XeroClient(ctx);
  const res = await xero.raw(`/Invoices/${encodeURIComponent(invoiceId)}`, { accept: "application/pdf" });
  if (!res.ok) throw new UserError(`Xero couldn't produce that PDF (${res.status}).`);
  return res.arrayBuffer();
}

/** Create the "Revenue Stream" tracking category with Qevero's five options (one-off setup, needs accounting.settings). */
export async function setupRevenueStreamTracking(ctx: Ctx) {
  const xero = new XeroClient(ctx);
  const existing = await xero.json<{ TrackingCategories?: { TrackingCategoryID: string; Name: string; Options?: { Name: string }[] }[] }>("/TrackingCategories");
  let cat = existing.TrackingCategories?.find((c) => c.Name.toLowerCase() === TRACKING_CATEGORY_NAME.toLowerCase());
  if (!cat) {
    const created = await xero.json<{ TrackingCategories: { TrackingCategoryID: string; Name: string }[] }>("/TrackingCategories", { method: "PUT", body: { Name: TRACKING_CATEGORY_NAME } });
    cat = { ...created.TrackingCategories[0], Options: [] };
  }
  const have = new Set((cat.Options ?? []).map((o) => o.Name.toLowerCase()));
  const missing = STREAMS.filter((s) => !have.has(s.label.toLowerCase()));
  for (const s of missing) await xero.json(`/TrackingCategories/${cat.TrackingCategoryID}/Options`, { method: "PUT", body: { Name: s.label } });
  await ctx.sb.from("xero_sync_state").delete().eq("owner_id", ctx.ownerId).eq("resource", "tracking");
  await audit(ctx, "xero.setup_tracking_category", cat.TrackingCategoryID, { added: missing.map((s) => s.label) });
  return { category: TRACKING_CATEGORY_NAME, added: missing.map((s) => s.label) };
}

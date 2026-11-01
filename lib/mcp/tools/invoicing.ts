import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Ctx, UserError } from "@/lib/ctx";
import { formatGbpFromPence, formatUkDate, parseDate, todayUk } from "@/lib/dates";
import { documentTotals } from "@/lib/invoicing/math";
import { GraphClient } from "@/lib/ms/graph";
import { listClients, upsertClient } from "@/lib/services/clients";
import { createProposal, getProposal, invoiceFromProposal, listProposals, proposalSummary, proposalToXeroQuote, setProposalStatus, updateProposal } from "@/lib/services/proposals";
import { TEMPLATES } from "@/lib/proposals/templates";
import { STREAM_IDS } from "@/lib/revenue/streams";
import { createInvoiceDraft, createPurchaseOrderDraft, createQuoteDraft, listQuotesAndPOs } from "@/lib/xero/actions";
import { confirmSchema, lineSchema, run, toDraftLines } from "../util";
import { env } from "@/lib/env";

const contactSchema = {
  contact: z.string().min(1).describe("Xero contact name (matched against Xero) or Xero ContactID"),
  contact_email: z.string().email().optional(),
  create_contact: z.boolean().optional().describe("Create the Xero contact if no match (confirm with Jasper first)"),
};

const asContact = (contact: string, email?: string, create?: boolean) =>
  /^[0-9a-f-]{36}$/i.test(contact) ? { contactId: contact, createIfMissing: create } : { name: contact, email: email ?? null, createIfMissing: create };

const date = (v: string | undefined) => {
  if (!v) return undefined;
  const iso = parseDate(v);
  if (!iso) throw new UserError(`"${v}" isn't a date — use DD/MM/YYYY.`);
  return iso;
};

function preview(kind: string, contact: string, lines: ReturnType<typeof toDraftLines>, extra: Record<string, unknown> = {}) {
  const t = documentTotals(lines);
  return {
    preview: true,
    kind,
    contact,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: formatGbpFromPence(l.unitPricePence), vat: l.vat, stream: l.stream })),
    net: formatGbpFromPence(t.netPence),
    vat: formatGbpFromPence(t.vatPence),
    total: formatGbpFromPence(t.grossPence),
    ...extra,
    note: `Read this back to Jasper. Call again with confirm=true to create it as a DRAFT in Xero (nothing is sent).`,
  };
}

export function registerInvoicingTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "list_invoices",
    {
      title: "List invoices / bills",
      description: "Invoices or bills from Jarvis's copy of Xero. Filter by status (unpaid, overdue, draft, paid, all), contact name, and invoice date range (DD/MM/YYYY).",
      inputSchema: {
        kind: z.enum(["sales", "bills"]).optional(),
        status: z.enum(["unpaid", "overdue", "draft", "paid", "all"]).optional(),
        contact: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(async () => {
      const today = todayUk();
      let q = ctx.sb.from("xero_invoices").select("invoice_id, type, number, reference, contact_name, status, date, due_date, total, amount_due, currency_code").eq("owner_id", ctx.ownerId).eq("type", a.kind === "bills" ? "ACCPAY" : "ACCREC").order("date", { ascending: false }).limit(a.limit ?? 30);
      const st = a.status ?? "unpaid";
      if (st === "unpaid") q = q.eq("status", "AUTHORISED").gt("amount_due", 0);
      if (st === "overdue") q = q.eq("status", "AUTHORISED").gt("amount_due", 0).lt("due_date", today);
      if (st === "draft") q = q.in("status", ["DRAFT", "SUBMITTED"]);
      if (st === "paid") q = q.eq("status", "PAID");
      if (a.contact) q = q.ilike("contact_name", `%${a.contact.replace(/[%_]/g, "")}%`);
      if (a.from) q = q.gte("date", date(a.from)!);
      if (a.to) q = q.lte("date", date(a.to)!);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((i) => ({ ...i, date: formatUkDate(i.date), due_date: formatUkDate(i.due_date), overdue: i.status === "AUTHORISED" && i.amount_due > 0 && i.due_date && i.due_date < today }));
    }),
  );

  server.registerTool(
    "get_invoice",
    { title: "Get invoice", description: "One invoice/bill with its lines (by Xero InvoiceID or invoice number).", inputSchema: { id_or_number: z.string().min(1) }, annotations: { readOnlyHint: true } },
    async ({ id_or_number }) => run(async () => {
      const col = /^[0-9a-f-]{36}$/i.test(id_or_number) ? "invoice_id" : "number";
      const { data: inv } = await ctx.sb.from("xero_invoices").select("*").eq("owner_id", ctx.ownerId).eq(col, id_or_number).maybeSingle();
      if (!inv) throw new UserError("Invoice not found in Jarvis's copy of Xero (try sync_xero).");
      const { data: lines } = await ctx.sb.from("xero_invoice_lines").select("description, quantity, unit_amount, line_amount, tax_amount, account_code, stream_option").eq("owner_id", ctx.ownerId).eq("invoice_id", inv.invoice_id).order("position");
      return { ...inv, lines, pdf: `${env.siteUrl()}/api/xero/invoice-pdf/${inv.invoice_id}` };
    }),
  );

  server.registerTool(
    "create_invoice_draft",
    {
      title: "Create invoice (draft)",
      description: "Create a standard sales invoice in Xero as a DRAFT (VAT 20% standard by default, prices ex VAT, 14-day terms by default). Tag each line with its revenue stream. Without confirm=true it returns a preview to read back. Jasper approves and sends it in Xero himself.",
      inputSchema: { ...contactSchema, lines: z.array(lineSchema).min(1).max(50), date: z.string().optional().describe("DD/MM/YYYY, default today"), due_date: z.string().optional(), reference: z.string().max(255).optional(), confirm: confirmSchema },
    },
    async (a) => run(async () => {
      const lines = toDraftLines(a.lines);
      if (!a.confirm) return preview("invoice", a.contact, lines, { date: a.date ?? formatUkDate(todayUk()), due_date: a.due_date ?? "14 days" });
      return createInvoiceDraft(ctx, { contact: asContact(a.contact, a.contact_email, a.create_contact), lines, date: date(a.date), dueDate: date(a.due_date), reference: a.reference });
    }),
  );

  server.registerTool(
    "create_quote_draft",
    {
      title: "Create quote (draft)",
      description: "Create a quote in Xero as a DRAFT. For a full written proposal use create_proposal instead (it can mirror to a Xero quote). Preview first; confirm=true creates it.",
      inputSchema: { ...contactSchema, lines: z.array(lineSchema).min(1).max(50), title: z.string().max(100).optional(), summary: z.string().max(3000).optional(), expiry_date: z.string().optional(), reference: z.string().optional(), confirm: confirmSchema },
    },
    async (a) => run(async () => {
      const lines = toDraftLines(a.lines);
      if (!a.confirm) return preview("quote", a.contact, lines, { title: a.title, expiry: a.expiry_date ?? "30 days" });
      return createQuoteDraft(ctx, { contact: asContact(a.contact, a.contact_email, a.create_contact), lines, title: a.title, summary: a.summary, expiryDate: date(a.expiry_date), reference: a.reference });
    }),
  );

  server.registerTool(
    "create_purchase_order_draft",
    {
      title: "Create purchase order (draft)",
      description: "Create a purchase order to a supplier in Xero as a DRAFT (input VAT 20% by default). Preview first; confirm=true creates it. Jasper approves and sends it in Xero.",
      inputSchema: { ...contactSchema, lines: z.array(lineSchema).min(1).max(50), delivery_date: z.string().optional(), reference: z.string().optional(), delivery_instructions: z.string().max(500).optional(), confirm: confirmSchema },
    },
    async (a) => run(async () => {
      const lines = toDraftLines(a.lines);
      if (!a.confirm) return preview("purchase order", a.contact, lines, { delivery: a.delivery_date ?? null });
      return createPurchaseOrderDraft(ctx, { contact: asContact(a.contact, a.contact_email, a.create_contact), lines, deliveryDate: date(a.delivery_date), reference: a.reference, deliveryInstructions: a.delivery_instructions });
    }),
  );

  server.registerTool(
    "list_quotes_and_purchase_orders",
    { title: "Quotes and POs", description: "Recent quotes and purchase orders straight from Xero (uses 2 API calls).", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => listQuotesAndPOs(ctx)),
  );

  server.registerTool(
    "draft_chase_email",
    {
      title: "Draft a payment chaser",
      description: "Create a polite payment-reminder email for an overdue invoice in Outlook Drafts (never sent). Write the body yourself in Jasper's voice; Jarvis fills in the recipient if Xero has their email.",
      inputSchema: { invoice_number: z.string(), body: z.string().min(10).max(5000), to: z.string().email().optional(), subject: z.string().max(200).optional() },
    },
    async (a) => run(async () => {
      const { data: inv } = await ctx.sb.from("xero_invoices").select("invoice_id, number, contact_id, contact_name, amount_due, due_date").eq("owner_id", ctx.ownerId).eq("number", a.invoice_number).maybeSingle();
      if (!inv) throw new UserError("Invoice not found.");
      let to = a.to;
      if (!to && inv.contact_id) to = (await ctx.sb.from("xero_contacts").select("email").eq("owner_id", ctx.ownerId).eq("contact_id", inv.contact_id).maybeSingle()).data?.email ?? undefined;
      if (!to) throw new UserError(`No email for ${inv.contact_name} in Xero — pass "to".`);
      return new GraphClient(ctx).createDraft({ to: [to], subject: a.subject ?? `Invoice ${inv.number} — payment reminder`, body: a.body });
    }),
  );

  // ─── Proposals ────────────────────────────────────────────────────────────
  server.registerTool(
    "create_proposal",
    {
      title: "Create proposal",
      description: `Create a written proposal in Jarvis (QP-0001 numbering) from a template: ${TEMPLATES.map((t) => `${t.id} (${t.name})`).join(", ")}. Pass lines to override template pricing (one-off or monthly). Write intro/sections tailored to the client. Jasper reviews it on the dashboard, prints it to PDF, and can mirror it to a Xero quote.`,
      inputSchema: {
        title: z.string().min(1).max(200),
        client_name: z.string().min(1).max(200),
        template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional(),
        contact_name: z.string().optional(),
        contact_email: z.string().email().optional(),
        intro: z.string().max(5000).optional(),
        sections: z.array(z.object({ heading: z.string(), body: z.string() })).max(20).optional(),
        lines: z.array(lineSchema).max(50).optional(),
        valid_days: z.number().int().min(1).max(180).optional(),
      },
    },
    async (a) => run(async () => {
      const p = await createProposal(ctx, { title: a.title, clientName: a.client_name, template: a.template, contactName: a.contact_name, contactEmail: a.contact_email, intro: a.intro, sections: a.sections, lines: a.lines ? toDraftLines(a.lines) : undefined, validDays: a.valid_days });
      return { id: p.id, number: p.number, summary: proposalSummary(p).text, edit: `${env.siteUrl()}/proposals/${p.id}`, print: `${env.siteUrl()}/proposals/${p.id}/print` };
    }),
  );

  server.registerTool(
    "update_proposal",
    {
      title: "Update proposal",
      description: "Edit a proposal's text, sections, pricing lines, deposit % or validity.",
      inputSchema: { id_or_number: z.string(), title: z.string().optional(), intro: z.string().optional(), sections: z.array(z.object({ heading: z.string(), body: z.string() })).optional(), lines: z.array(lineSchema).optional(), terms: z.string().optional(), deposit_percent: z.number().int().min(0).max(100).optional(), valid_until: z.string().optional(), contact_email: z.string().email().optional() },
    },
    async (a) => run(async () => {
      const p = await getProposal(ctx, a.id_or_number);
      const u = await updateProposal(ctx, p.id, { title: a.title, intro: a.intro, sections: a.sections, line_items: a.lines ? toDraftLines(a.lines) : undefined, terms: a.terms, deposit_percent: a.deposit_percent, valid_until: a.valid_until, contact_email: a.contact_email });
      return { number: u.number, summary: proposalSummary(u).text };
    }),
  );

  server.registerTool(
    "get_proposal",
    { title: "Get proposal", description: "A proposal in full, with totals.", inputSchema: { id_or_number: z.string() }, annotations: { readOnlyHint: true } },
    async ({ id_or_number }) => run(async () => {
      const p = await getProposal(ctx, id_or_number);
      return { ...p, totals: proposalSummary(p) };
    }),
  );

  server.registerTool(
    "list_proposals",
    { title: "List proposals", description: "Proposals with status and value. Filter by status (draft, sent, accepted, declined, expired).", inputSchema: { status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).optional() }, annotations: { readOnlyHint: true } },
    async ({ status }) => run(async () => (await listProposals(ctx, status)).map((p) => ({ id: p.id, number: p.number, title: p.title, client: p.client_name, status: p.status, issued: formatUkDate(p.issue_date), valid_until: formatUkDate(p.valid_until), value: proposalSummary(p).text, xero_quote: p.xero_quote_number }))),
  );

  server.registerTool(
    "set_proposal_status",
    { title: "Set proposal status", description: "Mark a proposal as sent, accepted, declined or expired (Jasper sends proposals himself).", inputSchema: { id_or_number: z.string(), status: z.enum(["draft", "sent", "accepted", "declined", "expired"]) } },
    async ({ id_or_number, status }) => run(async () => {
      const p = await getProposal(ctx, id_or_number);
      const u = await setProposalStatus(ctx, p.id, status);
      return { number: u.number, status: u.status };
    }),
  );

  server.registerTool(
    "proposal_to_xero_quote",
    { title: "Proposal → Xero quote", description: "Mirror a proposal's pricing into a DRAFT Xero quote. confirm=true required.", inputSchema: { id_or_number: z.string(), create_contact: z.boolean().optional(), confirm: confirmSchema } },
    async (a) => run(async () => {
      const p = await getProposal(ctx, a.id_or_number);
      if (!a.confirm) return { preview: true, proposal: p.number, client: p.client_name, value: proposalSummary(p).text, note: "Call with confirm=true to create the draft Xero quote." };
      return proposalToXeroQuote(ctx, p.id, a.create_contact);
    }),
  );

  server.registerTool(
    "invoice_from_proposal",
    {
      title: "Invoice from proposal",
      description: "Create a DRAFT Xero invoice from an accepted proposal: the deposit (default when a deposit % is set), the full one-off fees, or the first month's fees. Marks the proposal accepted. confirm=true required.",
      inputSchema: { id_or_number: z.string(), which: z.enum(["deposit", "full", "monthly"]).optional(), create_contact: z.boolean().optional(), confirm: confirmSchema },
    },
    async (a) => run(async () => {
      const p = await getProposal(ctx, a.id_or_number);
      if (!a.confirm) return { preview: true, proposal: p.number, client: p.client_name, which: a.which ?? (p.deposit_percent ? `deposit (${p.deposit_percent}%)` : "full one-off"), value: proposalSummary(p).text, note: "Call with confirm=true to create the draft invoice." };
      return invoiceFromProposal(ctx, p.id, { which: a.which, createContact: a.create_contact });
    }),
  );

  // ─── Clients ──────────────────────────────────────────────────────────────
  server.registerTool(
    "list_clients",
    { title: "List clients", description: "Qevero's clients with status, primary stream and retainer (used for the 'retainer not invoiced' flag).", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => (await listClients(ctx)).map((c) => ({ ...c, retainer_monthly: c.retainer_monthly_pence ? formatGbpFromPence(c.retainer_monthly_pence) : null }))),
  );

  server.registerTool(
    "upsert_client",
    {
      title: "Add or update client",
      description: "Create or update a client record (e.g. set a monthly retainer so Jarvis flags it if not invoiced).",
      inputSchema: { id: z.string().uuid().optional(), name: z.string().min(1), status: z.enum(["active", "prospect", "past"]).optional(), primary_stream: z.enum(STREAM_IDS as [string, ...string[]]).optional(), retainer_monthly: z.number().min(0).optional().describe("Pounds per month"), retainer_invoice_day: z.number().int().min(1).max(28).optional(), email: z.string().email().optional(), notes: z.string().max(5000).optional() },
    },
    async (a) => run(async () => upsertClient(ctx, { id: a.id, name: a.name, status: a.status, primaryStream: a.primary_stream, retainerMonthly: a.retainer_monthly ?? null, retainerInvoiceDay: a.retainer_invoice_day ?? null, email: a.email, notes: a.notes })),
  );
}

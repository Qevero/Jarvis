import { audit, UserError, type Ctx } from "@/lib/ctx";
import { formatGbpFromPence, parseDate, todayUk } from "@/lib/dates";
import { depositSplit, documentTotals, type DraftLine, type VatCode, VAT_CODES } from "@/lib/invoicing/math";
import { addDays } from "@/lib/periods";
import { isStreamId } from "@/lib/revenue/streams";
import { templateById, type ProposalSection } from "@/lib/proposals/templates";
import { createInvoiceDraft, createQuoteDraft } from "@/lib/xero/actions";

/** Proposals: written in Jarvis, printed to PDF, optionally mirrored to a Xero quote; accepted ones become draft invoices. */

export type ProposalRow = {
  id: string;
  number: string;
  title: string;
  client_name: string;
  client_id: string | null;
  xero_contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  issue_date: string;
  valid_until: string | null;
  intro: string | null;
  sections: ProposalSection[];
  line_items: DraftLine[];
  terms: string | null;
  deposit_percent: number | null;
  template: string | null;
  xero_quote_id: string | null;
  xero_quote_number: string | null;
  crm_lead_id: string | null;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "declined", "expired"] as const;

export function sanitiseLines(lines: unknown): DraftLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l) => l as Record<string, unknown>)
    .filter((l) => typeof l.description === "string" && l.description.trim())
    .slice(0, 50)
    .map((l) => ({
      description: String(l.description).trim().slice(0, 500),
      quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
      unitPricePence: Math.max(0, Math.round(Number(l.unitPricePence) || 0)),
      vat: VAT_CODES.includes(l.vat as VatCode) ? (l.vat as VatCode) : "standard",
      stream: typeof l.stream === "string" && isStreamId(l.stream) ? l.stream : null,
      billing: l.billing === "monthly" ? "monthly" : "one-off",
      accountCode: typeof l.accountCode === "string" && l.accountCode ? l.accountCode : null,
    }));
}

async function nextNumber(ctx: Ctx): Promise<string> {
  const { data } = await ctx.sb.from("proposals").select("number").eq("owner_id", ctx.ownerId).like("number", "QP-%").order("number", { ascending: false }).limit(1);
  const n = data?.[0] ? Number(String(data[0].number).replace(/\D/g, "")) + 1 : 1;
  return `QP-${String(n).padStart(4, "0")}`;
}

export function proposalSummary(p: ProposalRow) {
  const t = documentTotals(p.line_items);
  const dep = depositSplit(t.oneOffNetPence, p.deposit_percent);
  return {
    ...t,
    depositPence: dep.depositPence,
    text: `${formatGbpFromPence(t.oneOffNetPence)} one-off${t.monthlyNetPence ? ` + ${formatGbpFromPence(t.monthlyNetPence)}/month` : ""} (ex VAT); first-year value ${formatGbpFromPence(t.firstYearNetPence)}.`,
  };
}

export async function createProposal(ctx: Ctx, input: { title: string; clientName: string; template?: string | null; contactName?: string | null; contactEmail?: string | null; xeroContactId?: string | null; lines?: unknown; intro?: string | null; sections?: ProposalSection[]; validDays?: number; crmLeadId?: string | null }) {
  if (!input.title?.trim() || !input.clientName?.trim()) throw new UserError("A proposal needs a title and a client.");
  const tpl = templateById(input.template);
  const issue = todayUk();
  const lines = input.lines !== undefined ? sanitiseLines(input.lines) : tpl.lines;
  const { data, error } = await ctx.sb
    .from("proposals")
    .insert({
      owner_id: ctx.ownerId,
      number: await nextNumber(ctx),
      title: input.title.trim().slice(0, 200),
      client_name: input.clientName.trim().slice(0, 200),
      contact_name: input.contactName ?? null,
      contact_email: input.contactEmail ?? null,
      xero_contact_id: input.xeroContactId ?? null,
      issue_date: issue,
      valid_until: addDays(issue, input.validDays ?? 30),
      intro: input.intro ?? tpl.intro,
      sections: input.sections ?? tpl.sections,
      line_items: lines,
      terms: tpl.terms,
      deposit_percent: tpl.depositPercent,
      template: tpl.id,
      crm_lead_id: input.crmLeadId ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Creating proposal: ${error.message}`);
  await audit(ctx, "proposal.create", data.id, { number: data.number, client: data.client_name });
  return data as ProposalRow;
}

export async function getProposal(ctx: Ctx, idOrNumber: string): Promise<ProposalRow> {
  const isNum = /^QP-\d+$/i.test(idOrNumber);
  const { data } = await ctx.sb.from("proposals").select("*").eq("owner_id", ctx.ownerId).eq(isNum ? "number" : "id", isNum ? idOrNumber.toUpperCase() : idOrNumber).maybeSingle();
  if (!data) throw new UserError("Proposal not found.");
  return data as ProposalRow;
}

export async function listProposals(ctx: Ctx, status?: string | null) {
  let q = ctx.sb.from("proposals").select("*").eq("owner_id", ctx.ownerId).order("created_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProposalRow[];
}

export async function updateProposal(ctx: Ctx, id: string, patch: Partial<{ title: string; client_name: string; contact_name: string | null; contact_email: string | null; xero_contact_id: string | null; intro: string | null; sections: ProposalSection[]; line_items: unknown; terms: string | null; deposit_percent: number | null; valid_until: string | null; issue_date: string }>) {
  const row: Record<string, unknown> = { ...patch };
  if (patch.line_items !== undefined) row.line_items = sanitiseLines(patch.line_items);
  if (patch.sections !== undefined) row.sections = (patch.sections ?? []).filter((s) => s.heading?.trim() || s.body?.trim()).map((s) => ({ heading: (s.heading ?? "").slice(0, 200), body: (s.body ?? "").slice(0, 10_000) }));
  for (const k of ["valid_until", "issue_date"] as const) {
    if (patch[k]) {
      const iso = parseDate(patch[k]!);
      if (!iso) throw new UserError("Dates must be DD/MM/YYYY.");
      row[k] = iso;
    }
  }
  if (patch.deposit_percent !== undefined && patch.deposit_percent !== null) row.deposit_percent = Math.min(100, Math.max(0, Math.round(patch.deposit_percent)));
  const { data, error } = await ctx.sb.from("proposals").update(row).eq("owner_id", ctx.ownerId).eq("id", id).select("*").single();
  if (error) throw new Error(`Saving proposal: ${error.message}`);
  await audit(ctx, "proposal.update", id, { fields: Object.keys(patch) });
  return data as ProposalRow;
}

export async function setProposalStatus(ctx: Ctx, id: string, status: ProposalRow["status"]) {
  if (!PROPOSAL_STATUSES.includes(status)) throw new UserError("Unknown status.");
  const patch: Record<string, unknown> = { status };
  if (status === "sent") patch.sent_at = new Date().toISOString();
  if (status === "accepted" || status === "declined") patch.decided_at = new Date().toISOString();
  const { data, error } = await ctx.sb.from("proposals").update(patch).eq("owner_id", ctx.ownerId).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await audit(ctx, "proposal.status", id, { status });
  return data as ProposalRow;
}

export async function deleteProposal(ctx: Ctx, id: string) {
  await ctx.sb.from("proposals").delete().eq("owner_id", ctx.ownerId).eq("id", id);
  await audit(ctx, "proposal.delete", id);
}

/** Mirror the proposal's pricing into a DRAFT Xero quote. */
export async function proposalToXeroQuote(ctx: Ctx, id: string, createContact = false) {
  const p = await getProposal(ctx, id);
  if (!p.line_items.length) throw new UserError("Add pricing lines first.");
  const q = await createQuoteDraft(ctx, {
    contact: { contactId: p.xero_contact_id, name: p.client_name, email: p.contact_email, createIfMissing: createContact },
    lines: p.line_items.map((l) => ({ ...l, description: l.billing === "monthly" ? `${l.description} (monthly)` : l.description })),
    date: p.issue_date,
    expiryDate: p.valid_until,
    title: p.title,
    summary: p.intro,
    terms: p.terms,
    reference: p.number,
    proposalId: p.id,
  });
  await ctx.sb.from("proposals").update({ xero_quote_id: q.quoteId, xero_quote_number: q.number }).eq("id", p.id).eq("owner_id", ctx.ownerId);
  return q;
}

/** Turn an accepted proposal into DRAFT invoices: deposit (or full one-off) plus the first month of monthly fees. */
export async function invoiceFromProposal(ctx: Ctx, id: string, opts: { createContact?: boolean; which?: "deposit" | "full" | "monthly" } = {}) {
  const p = await getProposal(ctx, id);
  const oneOff = p.line_items.filter((l) => l.billing !== "monthly");
  const monthly = p.line_items.filter((l) => l.billing === "monthly");
  const which = opts.which ?? (p.deposit_percent ? "deposit" : "full");
  let lines: DraftLine[];
  if (which === "monthly") {
    if (!monthly.length) throw new UserError("This proposal has no monthly fees.");
    lines = monthly;
  } else if (which === "deposit") {
    const pct = p.deposit_percent ?? 0;
    if (!pct) throw new UserError("No deposit is set on this proposal.");
    lines = oneOff.map((l) => ({ ...l, description: `${pct}% deposit: ${l.description}`, unitPricePence: Math.round((l.unitPricePence * pct) / 100) }));
  } else {
    lines = oneOff;
  }
  if (!lines.length) throw new UserError("Nothing to invoice.");
  const inv = await createInvoiceDraft(ctx, {
    contact: { contactId: p.xero_contact_id, name: p.client_name, email: p.contact_email, createIfMissing: opts.createContact },
    lines,
    reference: `${p.number} ${p.title}`.slice(0, 255),
    proposalId: p.id,
  });
  if (p.status !== "accepted") await setProposalStatus(ctx, p.id, "accepted");
  return inv;
}

import { audit, UserError, type Ctx } from "@/lib/ctx";
import { parsePounds } from "@/lib/invoicing/math";
import { isStreamId } from "@/lib/revenue/streams";

/** Clients: links Xero contacts, CRM companies and retainer settings. */

export type ClientRow = {
  id: string;
  name: string;
  xero_contact_id: string | null;
  crm_company_id: string | null;
  email: string | null;
  status: "active" | "prospect" | "past";
  primary_stream: string | null;
  retainer_monthly_pence: number | null;
  retainer_invoice_day: number | null;
  notes: string | null;
};

export async function listClients(ctx: Ctx) {
  const { data, error } = await ctx.sb.from("clients").select("*").eq("owner_id", ctx.ownerId).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientRow[];
}

export async function upsertClient(ctx: Ctx, input: { id?: string; name: string; xeroContactId?: string | null; email?: string | null; status?: string; primaryStream?: string | null; retainerMonthly?: string | number | null; retainerInvoiceDay?: number | null; notes?: string | null; crmCompanyId?: string | null }) {
  if (!input.name?.trim()) throw new UserError("Client name is required.");
  const retainer = input.retainerMonthly === undefined || input.retainerMonthly === "" || input.retainerMonthly === null ? null : parsePounds(input.retainerMonthly);
  if (input.retainerMonthly && retainer === null) throw new UserError("Retainer must be an amount like 750 or 750.00.");
  const row = {
    owner_id: ctx.ownerId,
    name: input.name.trim(),
    xero_contact_id: input.xeroContactId || null,
    email: input.email || null,
    status: ["active", "prospect", "past"].includes(input.status ?? "") ? input.status : "active",
    primary_stream: input.primaryStream && isStreamId(input.primaryStream) ? input.primaryStream : null,
    retainer_monthly_pence: retainer,
    retainer_invoice_day: input.retainerInvoiceDay ? Math.min(28, Math.max(1, input.retainerInvoiceDay)) : null,
    notes: input.notes || null,
    crm_company_id: input.crmCompanyId || null,
  };
  const q = input.id ? ctx.sb.from("clients").update(row).eq("id", input.id).eq("owner_id", ctx.ownerId) : ctx.sb.from("clients").insert(row);
  const { data, error } = await q.select("*").single();
  if (error) throw new Error(error.message.includes("duplicate") ? "That Xero contact is already linked to another client." : error.message);
  await audit(ctx, input.id ? "client.update" : "client.create", data.id, { name: row.name });
  return data as ClientRow;
}

export async function deleteClient(ctx: Ctx, id: string) {
  await ctx.sb.from("clients").delete().eq("owner_id", ctx.ownerId).eq("id", id);
  await audit(ctx, "client.delete", id);
}

/** Create client records for every Xero customer not yet linked. */
export async function importClientsFromXero(ctx: Ctx) {
  const [{ data: contacts }, existing] = await Promise.all([ctx.sb.from("xero_contacts").select("contact_id, name, email").eq("owner_id", ctx.ownerId).eq("is_customer", true), listClients(ctx)]);
  const linked = new Set(existing.map((c) => c.xero_contact_id));
  const rows = (contacts ?? []).filter((c) => !linked.has(c.contact_id)).map((c) => ({ owner_id: ctx.ownerId, name: c.name, xero_contact_id: c.contact_id, email: c.email }));
  if (rows.length) {
    const { error } = await ctx.sb.from("clients").insert(rows);
    if (error) throw new Error(error.message);
  }
  await audit(ctx, "client.import_from_xero", null, { added: rows.length });
  return { added: rows.length };
}

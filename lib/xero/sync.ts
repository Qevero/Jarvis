import type { Ctx } from "@/lib/ctx";
import { audit } from "@/lib/ctx";
import { mapAccount, mapBankTransaction, mapContact, mapCreditNote, mapInvoice } from "./map";
import { XeroClient } from "./client";

/**
 * Incremental Xero → Supabase sync with a time budget (Netlify functions are
 * short-lived): each resource pages through changes since its last
 * successful run, saving progress so the next run resumes where it stopped.
 */

type Resource = "accounts" | "tracking" | "contacts" | "invoices" | "credit_notes" | "bank_transactions";
const ORDER: Resource[] = ["accounts", "tracking", "contacts", "invoices", "credit_notes", "bank_transactions"];

type State = { resource: string; modified_since: string | null; next_page: number | null; last_success_at: string | null };

export type SyncResult = { resources: Record<string, { pages: number; rows: number; done: boolean }>; calls: number; complete: boolean; error?: string };

async function loadState(ctx: Ctx): Promise<Map<string, State>> {
  const { data } = await ctx.sb.from("xero_sync_state").select("resource, modified_since, next_page, last_success_at").eq("owner_id", ctx.ownerId);
  return new Map((data ?? []).map((r) => [r.resource as string, r as State]));
}

async function saveState(ctx: Ctx, resource: string, patch: Partial<State> & { last_error?: string | null; last_run_at?: string }) {
  await ctx.sb.from("xero_sync_state").upsert({ owner_id: ctx.ownerId, resource, ...patch }, { onConflict: "owner_id,resource" });
}

async function upsert(ctx: Ctx, table: string, rows: Record<string, unknown>[], onConflict: string) {
  if (!rows.length) return;
  const { error } = await ctx.sb.from(table).upsert(rows.map((r) => ({ ...r, owner_id: ctx.ownerId })), { onConflict });
  if (error) throw new Error(`Saving ${table}: ${error.message}`);
}

async function saveDocs(ctx: Ctx, docs: ReturnType<typeof mapInvoice>[]) {
  await upsert(ctx, "xero_invoices", docs.map((d) => d.invoice), "owner_id,invoice_id");
  const ids = docs.map((d) => d.invoice.invoice_id);
  if (ids.length) {
    const { error } = await ctx.sb.from("xero_invoice_lines").delete().eq("owner_id", ctx.ownerId).in("invoice_id", ids);
    if (error) throw new Error(`Replacing invoice lines: ${error.message}`);
  }
  await upsert(ctx, "xero_invoice_lines", docs.flatMap((d) => d.lines), "owner_id,invoice_id,line_item_id");
}

export async function syncXero(ctx: Ctx, opts: { budgetMs?: number; full?: boolean } = {}): Promise<SyncResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 7000);
  const client = new XeroClient(ctx);
  const states = await loadState(ctx);
  const result: SyncResult = { resources: {}, calls: 0, complete: false };
  const startedAt = new Date().toISOString();

  try {
    for (const resource of ORDER) {
      const st = states.get(resource);
      const r: { pages: number; rows: number; done: boolean } = (result.resources[resource] = { pages: 0, rows: 0, done: false });
      const since = opts.full ? null : st?.modified_since ?? null;
      let page = st?.next_page ?? 1;

      if (resource === "accounts" || resource === "tracking") {
        // Small, slow-changing: refresh at most daily.
        if (!opts.full && st?.last_success_at && Date.now() - Date.parse(st.last_success_at) < 86_400_000) {
          r.done = true;
          continue;
        }
        if (resource === "accounts") {
          const body = await client.json<{ Accounts?: Record<string, unknown>[] }>("/Accounts");
          await upsert(ctx, "xero_accounts", (body.Accounts ?? []).map(mapAccount), "owner_id,account_id");
          r.rows = body.Accounts?.length ?? 0;
        } else {
          const body = await client.json<{ TrackingCategories?: { Name: string; Status: string; Options?: { Name: string; Status: string }[] }[] }>("/TrackingCategories");
          await ctx.sb.from("xero_report_cache").upsert({ owner_id: ctx.ownerId, key: "tracking_categories", data: body.TrackingCategories ?? [], fetched_at: new Date().toISOString() }, { onConflict: "owner_id,key" });
          r.rows = body.TrackingCategories?.length ?? 0;
        }
        r.pages = 1;
        r.done = true;
        await saveState(ctx, resource, { last_success_at: startedAt, last_run_at: startedAt, last_error: null, next_page: null });
        continue;
      }

      const path = { contacts: "/Contacts", invoices: "/Invoices", credit_notes: "/CreditNotes", bank_transactions: "/BankTransactions" }[resource];
      const key = { contacts: "Contacts", invoices: "Invoices", credit_notes: "CreditNotes", bank_transactions: "BankTransactions" }[resource];
      while (true) {
        if (Date.now() > deadline) {
          await saveState(ctx, resource, { next_page: page, last_run_at: startedAt });
          result.calls = client.callsMade;
          return result;
        }
        const body = await client.json<Record<string, Record<string, unknown>[]>>(path, { query: { page, ...(resource === "contacts" ? { includeArchived: "true" } : {}) }, ifModifiedSince: since });
        const items = body[key] ?? [];
        if (resource === "contacts") await upsert(ctx, "xero_contacts", items.map(mapContact), "owner_id,contact_id");
        if (resource === "invoices") await saveDocs(ctx, items.map(mapInvoice));
        if (resource === "credit_notes") await saveDocs(ctx, items.map(mapCreditNote));
        if (resource === "bank_transactions") await upsert(ctx, "xero_bank_transactions", items.map(mapBankTransaction), "owner_id,bank_transaction_id");
        r.pages++;
        r.rows += items.length;
        if (items.length < 100) break;
        page++;
      }
      r.done = true;
      await saveState(ctx, resource, { modified_since: startedAt, next_page: null, last_success_at: startedAt, last_run_at: startedAt, last_error: null });
    }
    result.complete = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : "Sync failed";
    await saveState(ctx, "_last", { last_run_at: startedAt, last_error: result.error });
  }
  result.calls = client.callsMade;
  if (result.complete) await saveState(ctx, "_last", { last_run_at: startedAt, last_success_at: startedAt, last_error: null });
  await audit(ctx, "xero.sync", null, { complete: result.complete, calls: result.calls, error: result.error ?? null, rows: Object.fromEntries(Object.entries(result.resources).map(([k, v]) => [k, v.rows])) });
  return result;
}

export async function lastSync(ctx: Ctx) {
  const { data } = await ctx.sb.from("xero_sync_state").select("last_run_at, last_success_at, last_error").eq("owner_id", ctx.ownerId).eq("resource", "_last").maybeSingle();
  return data as { last_run_at: string | null; last_success_at: string | null; last_error: string | null } | null;
}

/** Cached Xero report (P&L, bank summary) to stay within the call budget. */
export async function cachedReport(ctx: Ctx, key: string, maxAgeMinutes: number, fetcher: (c: XeroClient) => Promise<unknown>) {
  const { data } = await ctx.sb.from("xero_report_cache").select("data, fetched_at").eq("owner_id", ctx.ownerId).eq("key", key).maybeSingle();
  if (data && Date.now() - Date.parse(data.fetched_at) < maxAgeMinutes * 60_000) return { data: data.data, fetchedAt: data.fetched_at as string, cached: true };
  const fresh = await fetcher(new XeroClient(ctx));
  const fetchedAt = new Date().toISOString();
  await ctx.sb.from("xero_report_cache").upsert({ owner_id: ctx.ownerId, key, data: fresh, fetched_at: fetchedAt }, { onConflict: "owner_id,key" });
  return { data: fresh, fetchedAt, cached: false };
}

export async function trackingCategoryExists(ctx: Ctx): Promise<boolean> {
  const { data } = await ctx.sb.from("xero_report_cache").select("data").eq("owner_id", ctx.ownerId).eq("key", "tracking_categories").maybeSingle();
  const cats = (data?.data as { Name: string; Status?: string }[] | undefined) ?? [];
  return cats.some((c) => c.Name.toLowerCase().replace(/[^a-z]/g, "") === "revenuestream" && (c.Status ?? "ACTIVE") === "ACTIVE");
}

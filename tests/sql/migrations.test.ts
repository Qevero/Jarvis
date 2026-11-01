import { beforeAll, describe, expect, it } from "vitest";
import { database } from "./pglite";

const JASPER = "11111111-1111-1111-1111-111111111111";
const MALLORY = "22222222-2222-2222-2222-222222222222";

let h: Awaited<ReturnType<typeof database>>;

beforeAll(async () => {
  h = await database();
  await h.addUser(JASPER, "jasper@qevero.com");
  await h.addUser(MALLORY, "mallory@example.com");
}, 60_000);

describe("migrations", () => {
  it("apply cleanly and enable RLS on every public table", async () => {
    const { rows } = await h.db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    );
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("isolates owners from each other", async () => {
    await h.as(JASPER, "insert into public.journal_entries (title, themes) values ('Pricing thoughts', '{pricing,seo}')");
    await h.as(JASPER, "insert into public.company_fields (key, value) values ('vat_number', 'GB531607691')");
    expect(await h.as(MALLORY, "select * from public.journal_entries")).toEqual([]);
    expect(await h.as(MALLORY, "select * from public.company_fields")).toEqual([]);
    expect(await h.as(null, "select * from public.ping()")).toEqual([{ ping: "ok" }]);
    await expect(h.as(null, "select * from public.company_fields")).rejects.toThrow();
  });

  it("keeps the audit log append-only", async () => {
    await h.as(JASPER, "insert into public.audit_log (source, action) values ('mcp', 'test')");
    await expect(h.as(JASPER, "update public.audit_log set action = 'x'")).rejects.toThrow();
    await expect(h.as(JASPER, "delete from public.audit_log")).rejects.toThrow();
    await h.as(JASPER, "insert into public.audit_log (source, action) values ('cron', 'sync')");
  });

  it("maintains journal search and theme counts", async () => {
    const hits = await h.as(JASPER, "select title from public.journal_entries where search @@ websearch_to_tsquery('english', 'pricing')");
    expect(hits).toEqual([{ title: "Pricing thoughts" }]);
    const themes = await h.as<{ theme: string; entries: number }>(JASPER, "select theme, entries::int from public.journal_theme_counts('2000-01-01', '2100-01-01')");
    expect(themes.map((t) => t.theme).sort()).toEqual(["pricing", "seo"]);
  });

  it("searches imported Claude chats", async () => {
    const [conv] = await h.as<{ id: string }>(JASPER, "insert into public.chat_conversations (external_id, title) values ('c1', 'Retainer pricing') returning id");
    await h.as(JASPER, "insert into public.chat_messages (conversation_id, external_id, position, sender, body) values ($1, 'm1', 0, 'human', 'Should SEO retainers start at £750 a month for local businesses?')", [conv.id]);
    const res = await h.as<{ conversation_title: string; snippet: string }>(JASPER, "select * from public.search_chat_messages('seo retainer')");
    expect(res[0].conversation_title).toBe("Retainer pricing");
    expect(res[0].snippet).toContain("«");
    expect(await h.as(MALLORY, "select * from public.search_chat_messages('seo')")).toEqual([]);
  });

  it("cascades invoice lines and enforces types", async () => {
    await h.as(JASPER, "insert into public.xero_invoices (invoice_id, type, status) values ('inv1', 'ACCREC', 'AUTHORISED')");
    await h.as(JASPER, "insert into public.xero_invoice_lines (invoice_id, line_item_id, line_amount, net_amount) values ('inv1', 'l1', 100, 100)");
    await expect(h.as(JASPER, "insert into public.xero_invoices (invoice_id, type, status) values ('inv2', 'NOPE', 'DRAFT')")).rejects.toThrow();
    await h.as(JASPER, "delete from public.xero_invoices where invoice_id = 'inv1'");
    expect(await h.as(JASPER, "select * from public.xero_invoice_lines")).toEqual([]);
  });

  it("numbers proposals uniquely per owner", async () => {
    await h.as(JASPER, "insert into public.proposals (number, title, client_name) values ('QP-0001', 'Website rebuild', 'World of Beds')");
    await expect(h.as(JASPER, "insert into public.proposals (number, title, client_name) values ('QP-0001', 'Dup', 'X')")).rejects.toThrow();
    await h.as(MALLORY, "insert into public.proposals (number, title, client_name) values ('QP-0001', 'Other', 'Y')");
  });
});

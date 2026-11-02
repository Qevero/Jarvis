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

describe("personal ingest", () => {
  const TOKEN = "t".repeat(48);
  beforeAll(async () => {
    await h.as(JASPER, "insert into public.ingest_tokens (name, token_hash, scopes) values ('iPhone', encode(sha256(convert_to($1, 'UTF8')), 'hex'), array['health','messages'])", [TOKEN]);
  });

  it("merges health days from a device token (anon key) without overwriting with blanks", async () => {
    const r1 = await h.as<{ r: { accepted: number } }>(null, "select public.jarvis_ingest($1, 'health', $2) as r", [TOKEN, JSON.stringify([{ day: "2026-11-02", energy_kcal: 2100, protein_g: 150 }])]);
    expect(r1[0].r.accepted).toBe(1);
    await h.as(null, "select public.jarvis_ingest($1, 'health', $2)", [TOKEN, JSON.stringify([{ day: "2026-11-02", weight_kg: 82.4 }])]);
    const rows = await h.as<{ energy_kcal: string; weight_kg: string }>(JASPER, "select energy_kcal, weight_kg from public.health_daily");
    expect(rows).toEqual([{ energy_kcal: "2100.0", weight_kg: "82.40" }]);
    expect(await h.as(MALLORY, "select * from public.health_daily")).toEqual([]);
  });

  it("rejects bad tokens and scopes the token can't use", async () => {
    await expect(h.as(null, "select public.jarvis_ingest('nope', 'health', '[]')")).rejects.toThrow(/Invalid or revoked/);
    await expect(h.as(null, "select public.jarvis_ingest($1, 'workouts', '[]')", [TOKEN])).rejects.toThrow(/Invalid or revoked/);
    await expect(h.as(null, "select * from public.ingest_tokens")).rejects.toThrow();
  });

  it("dedupes messages and purges ones past retention", async () => {
    const msg = (id: string, sent: string) => ({ source: "whatsapp", external_id: id, chat_name: "Mum", sender: "Mum", sent_at: sent, body_enc: "v1.x.y.z" });
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const r = await h.as<{ r: { accepted: number } }>(null, "select public.jarvis_ingest($1, 'messages', $2) as r", [TOKEN, JSON.stringify([msg("a", now), msg("a", now), msg("b", old)])]);
    expect(r[0].r.accepted).toBe(2);
    const rows = await h.as<{ external_id: string }>(JASPER, "select external_id from public.messages_inbox");
    expect(rows.map((x) => x.external_id)).toEqual(["a"]);
    const read = await h.as<{ r: { accepted: number } }>(null, "select public.jarvis_ingest($1, 'messages_read', $2) as r", [TOKEN, JSON.stringify([{ source: "whatsapp", external_id: "a" }])]);
    expect(read[0].r.accepted).toBe(1);
    expect(await h.as(JASPER, "select external_id from public.messages_inbox where seen_at is null")).toEqual([]);
  });

  it("allows the new memory kinds and Hevy connections", async () => {
    await h.as(JASPER, "insert into public.knowledge_items (title, kind) values ('Bench goal', 'health')");
    await h.as(JASPER, "insert into public.integration_connections (provider) values ('hevy')");
  });
});

describe("labs: captures and check-ins", () => {
  const TOKEN = "c".repeat(48);
  it("captures via a capture-scoped token only", async () => {
    await h.as(JASPER, "insert into public.ingest_tokens (name, token_hash, scopes) values ('iPhone share', encode(sha256(convert_to($1, 'UTF8')), 'hex'), array['capture','messages'])", [TOKEN]);
    const [r] = await h.as<{ id: string }>(null, "select public.jarvis_capture($1, 'link', 'Article', 'https://example.com', null) as id", [TOKEN]);
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
    expect(await h.as(JASPER, "select kind, title, status from public.captures")).toEqual([{ kind: "link", title: "Article", status: "new" }]);
    expect(await h.as(MALLORY, "select * from public.captures")).toEqual([]);
    await expect(h.as(null, "select public.jarvis_capture($1, 'note', 'x', null, null)", ["t".repeat(48)])).rejects.toThrow(/Invalid or revoked/);
  });
  it("stores one check-in per day with 1–5 scores", async () => {
    await h.as(JASPER, "insert into public.checkins (day, mood, energy, sleep) values ('2026-11-03', 4, 3, 5)");
    await expect(h.as(JASPER, "insert into public.checkins (day, mood) values ('2026-11-04', 9)")).rejects.toThrow();
  });
});
